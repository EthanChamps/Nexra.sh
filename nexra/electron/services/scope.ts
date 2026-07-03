import { randomUUID } from 'node:crypto'
import { getScopeRow, setScopeRow, getSetting, setSetting, insertScopeItem, deleteScopeItem, listScopeItems } from './store.sqlite'
import type { EngagementScope, ProjectScope, ScopeItem, ScopeItemType } from './store.types'

// Engagement scope: the trusted, structured allowlist enforced BELOW the LLM.
// The agent may ask the operator to populate it (scope_request), but the
// authoritative value is this record — never a sentence parsed out of chat.

export function getScope(engagementId: string): EngagementScope | undefined {
  return getScopeRow(engagementId)
}

export function setScope(engagementId: string, scope: EngagementScope): void {
  setScopeRow(engagementId, scope)
}

export interface Target { account?: string; region?: string; ip?: string; hostname?: string; url?: string }
export interface Decision { allowed: boolean; reason?: string }
export interface ScopeDecision { allowed: boolean; reason?: string; propose?: { type: ScopeItemType; value: string } }

// Validate a typed-skill target against a scope record. `mode:'all'` permits
// anything the injected credential can reach. `mode:'allowlist'` checks each
// dimension whose list is non-empty; a fully-empty allowlist fails CLOSED (an
// unconfigured allowlist must not silently permit everything).
export function validate(target: Target, scope: EngagementScope): Decision {
  if (scope.mode === 'all') return { allowed: true }

  if (scope.accounts.length === 0 && scope.regions.length === 0)
    return { allowed: false, reason: 'scope allowlist is empty — nothing is in scope' }

  if (scope.accounts.length > 0) {
    if (!target.account) return { allowed: false, reason: 'target account required by allowlist' }
    if (!scope.accounts.includes(target.account))
      return { allowed: false, reason: `account ${target.account} is out of scope` }
  }
  if (scope.regions.length > 0) {
    if (!target.region) return { allowed: false, reason: 'target region required by allowlist' }
    if (!scope.regions.includes(target.region))
      return { allowed: false, reason: `region ${target.region} is out of scope` }
  }
  return { allowed: true }
}

// ── Project-level scope (company-shared, enforced) ──────────────────────────
// The single authoritative authorized-target list for a project. Read by the
// agent and enforced BELOW the LLM by matchesScope (never a sentence parsed
// from chat). Notes are freeform, informational, and never gate anything.
const NOTES_KEY = (companyId: string) => 'scope_notes:' + companyId

export function getProjectScope(companyId: string): ProjectScope {
  return { companyId, items: listScopeItems(companyId), notes: getSetting(NOTES_KEY(companyId)) ?? '' }
}

export function addScopeItem(companyId: string, input: { type: ScopeItemType; value: string; source: 'user' | 'agent' }): ScopeItem {
  const item: ScopeItem = { id: randomUUID(), type: input.type, value: input.value.trim(), source: input.source, addedAt: Date.now() }
  insertScopeItem(companyId, item)
  return item
}

export function removeScopeItem(companyId: string, id: string): void {
  deleteScopeItem(companyId, id)
}

export function setScopeNotes(companyId: string, notes: string): void {
  setSetting(NOTES_KEY(companyId), notes)
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) { const x = Number(p); if (!Number.isInteger(x) || x < 0 || x > 255) return null; n = (n << 8) | x }
  return n >>> 0
}

// IPv4-only CIDR containment. Any malformed input (bad ip, bad prefix, IPv6)
// returns false rather than throwing — a non-parseable target simply doesn't
// match, so the gate fails closed.
export function ipInCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/')
  const bits = Number(bitsStr)
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false
  const a = ipv4ToInt(ip); const b = ipv4ToInt(range)
  if (a == null || b == null) return false
  if (bits === 0) return true
  const mask = (0xffffffff << (32 - bits)) >>> 0
  return (a & mask) === (b & mask)
}

function hostOfUrl(u: string): string | undefined {
  try { return new URL(u).hostname } catch { return undefined }
}

// Authorize a tool's concrete target against the project scope. In-scope-only:
// a target dimension is enforced ONLY if the scope contains items of a type
// that constrains it; an enforced-but-unmatched dimension denies and yields a
// `propose` value for the confirm card. Empty scope (no relevant items) fails
// closed. `other` items are informational and constrain nothing.
export function matchesScope(target: Target, scope: ProjectScope): ScopeDecision {
  const items = scope.items
  const has = (t: ScopeItemType) => items.some(i => i.type === t)
  const host = target.hostname ?? (target.url ? hostOfUrl(target.url) : undefined)

  const checks = [
    { label: 'account', present: target.account != null, enforced: has('cloud_account'),
      matched: !!target.account && items.some(i => i.type === 'cloud_account' && i.value === target.account),
      propose: target.account ? { type: 'cloud_account' as const, value: target.account } : undefined },
    { label: 'region', present: target.region != null, enforced: has('region'),
      matched: !!target.region && items.some(i => i.type === 'region' && i.value === target.region),
      propose: target.region ? { type: 'region' as const, value: target.region } : undefined },
    { label: 'ip', present: target.ip != null, enforced: has('ip') || has('cidr'),
      matched: !!target.ip && (items.some(i => i.type === 'ip' && i.value === target.ip) || items.some(i => i.type === 'cidr' && ipInCidr(target.ip!, i.value))),
      propose: target.ip ? { type: 'ip' as const, value: target.ip } : undefined },
    { label: 'host', present: (target.hostname ?? target.url) != null, enforced: has('hostname') || has('url'),
      matched: !!host && (items.some(i => i.type === 'hostname' && i.value === host) || items.some(i => i.type === 'url' && hostOfUrl(i.value) === host)),
      propose: (target.hostname ?? target.url) ? { type: (target.hostname ? 'hostname' : 'url') as ScopeItemType, value: (target.hostname ?? target.url)! } : undefined },
  ]

  const present = checks.filter(c => c.present)
  if (present.length === 0) return { allowed: false, reason: 'no target to check against scope' }

  for (const c of present) {
    if (c.enforced && !c.matched) return { allowed: false, reason: `${c.label} ${c.propose?.value} is out of scope`, propose: c.propose }
  }
  if (!present.some(c => c.enforced)) {
    const c = present[0]
    return { allowed: false, reason: `${c.label} ${c.propose?.value} is not covered by any in-scope item`, propose: c.propose }
  }
  return { allowed: true }
}
