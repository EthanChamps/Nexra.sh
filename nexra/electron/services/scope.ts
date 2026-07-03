import { getScopeRow, setScopeRow } from './store.sqlite'
import type { EngagementScope } from './store.types'

// Engagement scope: the trusted, structured allowlist enforced BELOW the LLM.
// The agent may ask the operator to populate it (scope_request), but the
// authoritative value is this record — never a sentence parsed out of chat.

export function getScope(engagementId: string): EngagementScope | undefined {
  return getScopeRow(engagementId)
}

export function setScope(engagementId: string, scope: EngagementScope): void {
  setScopeRow(engagementId, scope)
}

export interface Target { account?: string; region?: string }
export interface Decision { allowed: boolean; reason?: string }

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
