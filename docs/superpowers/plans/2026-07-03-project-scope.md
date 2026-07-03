# Project Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a project-level (company-shared), enforced scope: a list of authorized `{type, value}` target items plus freeform notes, shown in the context panel, read and appendable by the agent (with user confirmation), and enforced by the below-the-LLM tool gate.

**Architecture:** A new company-keyed `project_scope` sqlite table + notes setting, fronted by a rewritten `scope.ts` service exposing `getProjectScope`/`addScopeItem`/`removeScopeItem`/`setScopeNotes` and a pure `matchesScope` used by the `runSkill` gate. The gate, instead of dead-ending on an out-of-scope target, emits a `scope_proposal` event that renders a confirm card (reusing the request-card → resume machinery). The agent may also propose items explicitly via a `propose_scope_item` skill. The panel follows the existing `SecretsPanel` pattern: a self-contained component that fetches over `window.nexra.projectScope.*`. The legacy per-engagement enforced scope (`EngagementScope`, `scope` table, `scope:*` IPC, `scope_request` event, RequestCard `scope` variant) is removed in the final task; the legacy per-engagement *display* rows (`ScopeRow` / `Engagement.scope`) are intentionally left in the data layer (seed-only, now unused by the UI) to avoid a risky engagements-table column migration.

**Tech Stack:** Electron main + preload/contextBridge IPC, React 18 + Vite renderer, `better-sqlite3`, Vercel AI SDK v6 agent, Vitest + @testing-library/react (jsdom), TypeScript.

## Global Constraints

- **No renderer component may import a service directly** — always go through `window.nexra.*`.
- **Styling source of truth:** `nexra/design-reference/Nexra.dc.html` — match hex/px exactly; do not snap rgba alphas to the nearest `theme.ts` token. Reuse existing `theme` tokens already used by `ContextPanel.tsx` / `SecretsPanel.tsx` / `RequestCard.tsx`.
- **Icons are for actions and status, not decoration.** The scope panel's provenance dot (status) and `×` remove (action) are meaningful and allowed; add no other glyphs.
- **Scope model:** in-scope-only (everything listed is authorized; no out-of-scope exclusions). **Empty scope denies everything** (fail closed). `other`-typed items never match the gate (informational).
- **Notes** are user-edited and agent-read; the agent proposes *items*, never notes.
- TDD: write the failing test first. Commit after every green step. Run a single test file with `npx vitest run test/<file>`; the full suite with `npm test`; types with `npm run typecheck`.
- All paths below are relative to `nexra/`.

---

### Task 1: Data model + `project_scope` persistence

**Files:**
- Modify: `electron/services/store.types.ts` (add scope-item types near line 61)
- Modify: `electron/services/store.sqlite.ts` (add table in `initSettingsDb`; add accessors after the secret-value section ~line 175)
- Test: `test/store.sqlite.scope.test.ts` (create)

**Interfaces:**
- Produces:
  - `ScopeItemType = 'cidr'|'ip'|'hostname'|'url'|'cloud_account'|'tenant_id'|'region'|'other'`
  - `ScopeItem { id: string; type: ScopeItemType; value: string; source: 'user'|'agent'; addedAt: number }`
  - `ProjectScope { companyId: string; items: ScopeItem[]; notes: string }`
  - `insertScopeItem(companyId: string, item: ScopeItem): void`
  - `deleteScopeItem(companyId: string, id: string): void`
  - `listScopeItems(companyId: string): ScopeItem[]`

- [ ] **Step 1: Add the types to `store.types.ts`**

Insert immediately after the `EngagementScope` interface (after line 61):

```ts
// Project-level (company-shared) enforced scope. A flat list of authorized
// targets — everything listed is in scope (there are no out-of-scope
// exclusions). `source` records whether the operator hand-added it or the
// agent proposed it and the operator confirmed. Shared by every engagement in
// the project, exactly like the credential vault.
export type ScopeItemType =
  | 'cidr' | 'ip' | 'hostname' | 'url'
  | 'cloud_account' | 'tenant_id' | 'region' | 'other'
export interface ScopeItem {
  id: string
  type: ScopeItemType
  value: string
  source: 'user' | 'agent'
  addedAt: number
}
export interface ProjectScope {
  companyId: string
  items: ScopeItem[]
  notes: string
}
```

- [ ] **Step 2: Write the failing persistence test**

Create `test/store.sqlite.scope.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initSettingsDb, insertScopeItem, deleteScopeItem, listScopeItems } from '../electron/services/store.sqlite'
import type { ScopeItem } from '../electron/services/store.types'

const item = (over: Partial<ScopeItem> = {}): ScopeItem =>
  ({ id: 'si1', type: 'cloud_account', value: '111111111111', source: 'user', addedAt: 10, ...over })

describe('project_scope persistence', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-pscope-')); initSettingsDb(join(dir, 'nexra.db')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('is empty until an item is inserted', () => {
    expect(listScopeItems('c1')).toEqual([])
  })

  it('round-trips items per company, ordered by addedAt', () => {
    insertScopeItem('c1', item({ id: 'a', value: '111111111111', addedAt: 20 }))
    insertScopeItem('c1', item({ id: 'b', type: 'cidr', value: '10.0.0.0/8', addedAt: 10 }))
    insertScopeItem('c2', item({ id: 'c', value: '999999999999', addedAt: 5 }))
    expect(listScopeItems('c1').map(i => i.id)).toEqual(['b', 'a'])
    expect(listScopeItems('c2').map(i => i.id)).toEqual(['c'])
  })

  it('deletes only the matching (company, id) pair', () => {
    insertScopeItem('c1', item({ id: 'a' }))
    insertScopeItem('c1', item({ id: 'b', type: 'region', value: 'us-east-1' }))
    deleteScopeItem('c1', 'a')
    expect(listScopeItems('c1').map(i => i.id)).toEqual(['b'])
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/store.sqlite.scope.test.ts`
Expected: FAIL — `insertScopeItem` / `deleteScopeItem` / `listScopeItems` are not exported.

- [ ] **Step 4: Add the table and accessors to `store.sqlite.ts`**

In the import on line 2, add `ScopeItem`:

```ts
import type { Secret, SecretField, EngagementScope, Finding, Evidence, ScopeItem } from './store.types'
```

Inside `initSettingsDb`, add the table right after the existing `scope` table block (after line 45):

```ts
  // Project-level (company-shared) enforced scope. Flat authorized-target list.
  db.exec(`CREATE TABLE IF NOT EXISTS project_scope (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    source TEXT NOT NULL,
    added_at INTEGER NOT NULL
  )`)
```

Add the accessors after the scope section (after line 189, before the findings section):

```ts
// ── project scope (company-shared, enforced) ────────────────────────────────
interface ScopeItemRow { id: string; company_id: string; type: string; value: string; source: string; added_at: number }

export function insertScopeItem(companyId: string, item: ScopeItem): void {
  requireDb().prepare(
    `INSERT INTO project_scope (id, company_id, type, value, source, added_at)
     VALUES (@id, @company_id, @type, @value, @source, @added_at)
     ON CONFLICT(id) DO UPDATE SET type=excluded.type, value=excluded.value, source=excluded.source`,
  ).run({ id: item.id, company_id: companyId, type: item.type, value: item.value, source: item.source, added_at: item.addedAt })
}

export function deleteScopeItem(companyId: string, id: string): void {
  requireDb().prepare('DELETE FROM project_scope WHERE company_id = ? AND id = ?').run(companyId, id)
}

export function listScopeItems(companyId: string): ScopeItem[] {
  const rows = requireDb().prepare('SELECT * FROM project_scope WHERE company_id = ? ORDER BY added_at, rowid').all(companyId) as ScopeItemRow[]
  return rows.map(r => ({ id: r.id, type: r.type as ScopeItem['type'], value: r.value, source: r.source as ScopeItem['source'], addedAt: r.added_at }))
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/store.sqlite.scope.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add electron/services/store.types.ts electron/services/store.sqlite.ts test/store.sqlite.scope.test.ts
git commit -m "feat(scope): project_scope table + ScopeItem model"
```

---

### Task 2: Scope service — `getProjectScope`, mutators, and `matchesScope`

**Files:**
- Modify: `electron/services/scope.ts` (expand `Target`; add project-scope functions and `matchesScope`/`ipInCidr` — leave the legacy `getScope`/`setScope`/`validate` in place for now)
- Test: `test/scope.project.test.ts` (create)

**Interfaces:**
- Consumes: `insertScopeItem`/`deleteScopeItem`/`listScopeItems` (Task 1), `getSetting`/`setSetting` (existing in `store.sqlite.ts`), `ProjectScope`/`ScopeItem`/`ScopeItemType` (Task 1).
- Produces:
  - `getProjectScope(companyId: string): ProjectScope`
  - `addScopeItem(companyId: string, input: { type: ScopeItemType; value: string; source: 'user'|'agent' }): ScopeItem`
  - `removeScopeItem(companyId: string, id: string): void`
  - `setScopeNotes(companyId: string, notes: string): void`
  - `interface Target { account?; region?; ip?; hostname?; url?: string }` (expanded)
  - `interface ScopeDecision { allowed: boolean; reason?: string; propose?: { type: ScopeItemType; value: string } }`
  - `matchesScope(target: Target, scope: ProjectScope): ScopeDecision`
  - `ipInCidr(ip: string, cidr: string): boolean`

- [ ] **Step 1: Write the failing `matchesScope` + persistence test**

Create `test/scope.project.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initSettingsDb } from '../electron/services/store.sqlite'
import { getProjectScope, addScopeItem, removeScopeItem, setScopeNotes, matchesScope, ipInCidr } from '../electron/services/scope'
import type { ProjectScope, ScopeItem } from '../electron/services/store.types'

const scopeOf = (items: Partial<ScopeItem>[], notes = ''): ProjectScope => ({
  companyId: 'c1', notes,
  items: items.map((i, n) => ({ id: 'i' + n, type: 'cloud_account', value: '', source: 'user', addedAt: n, ...i } as ScopeItem)),
})

describe('ipInCidr (IPv4)', () => {
  it('matches an address inside the range', () => {
    expect(ipInCidr('10.1.2.3', '10.0.0.0/8')).toBe(true)
    expect(ipInCidr('192.168.1.5', '192.168.1.0/24')).toBe(true)
    expect(ipInCidr('1.2.3.4', '0.0.0.0/0')).toBe(true)
  })
  it('rejects an address outside the range and malformed input', () => {
    expect(ipInCidr('10.1.2.3', '11.0.0.0/8')).toBe(false)
    expect(ipInCidr('192.168.2.5', '192.168.1.0/24')).toBe(false)
    expect(ipInCidr('not-an-ip', '10.0.0.0/8')).toBe(false)
    expect(ipInCidr('10.0.0.1', '10.0.0.0/33')).toBe(false)
  })
})

describe('matchesScope (pure, below the LLM)', () => {
  it('empty scope denies and proposes the target account', () => {
    const d = matchesScope({ account: '111111111111' }, scopeOf([]))
    expect(d.allowed).toBe(false)
    expect(d.propose).toEqual({ type: 'cloud_account', value: '111111111111' })
  })
  it('permits an in-scope cloud account', () => {
    expect(matchesScope({ account: '111111111111' }, scopeOf([{ type: 'cloud_account', value: '111111111111' }])).allowed).toBe(true)
  })
  it('denies an out-of-scope account and proposes it', () => {
    const d = matchesScope({ account: '999999999999' }, scopeOf([{ type: 'cloud_account', value: '111111111111' }]))
    expect(d.allowed).toBe(false)
    expect(d.reason).toMatch(/out of scope/i)
    expect(d.propose).toEqual({ type: 'cloud_account', value: '999999999999' })
  })
  it('leaves region unconstrained when scope has no region items', () => {
    expect(matchesScope({ account: '111111111111', region: 'eu-west-9' }, scopeOf([{ type: 'cloud_account', value: '111111111111' }])).allowed).toBe(true)
  })
  it('enforces region once a region item exists', () => {
    const scope = scopeOf([{ type: 'cloud_account', value: '111111111111' }, { type: 'region', value: 'us-east-1' }])
    expect(matchesScope({ account: '111111111111', region: 'us-east-1' }, scope).allowed).toBe(true)
    const d = matchesScope({ account: '111111111111', region: 'eu-west-1' }, scope)
    expect(d.allowed).toBe(false)
    expect(d.propose).toEqual({ type: 'region', value: 'eu-west-1' })
  })
  it('matches an ip inside a cidr item and a hostname behind a url item', () => {
    expect(matchesScope({ ip: '10.9.9.9' }, scopeOf([{ type: 'cidr', value: '10.0.0.0/8' }])).allowed).toBe(true)
    expect(matchesScope({ hostname: 'app.acme.com' }, scopeOf([{ type: 'url', value: 'https://app.acme.com/login' }])).allowed).toBe(true)
    expect(matchesScope({ url: 'https://app.acme.com/x' }, scopeOf([{ type: 'hostname', value: 'app.acme.com' }])).allowed).toBe(true)
  })
  it('never matches on `other` items and denies when nothing is checkable', () => {
    expect(matchesScope({ account: '111111111111' }, scopeOf([{ type: 'other', value: 'note' }])).allowed).toBe(false)
    expect(matchesScope({}, scopeOf([{ type: 'cloud_account', value: '111111111111' }])).allowed).toBe(false)
  })
})

describe('project scope persistence', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-pscopesvc-')); initSettingsDb(join(dir, 'nexra.db')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('add/list/remove round-trips with generated id + source', () => {
    const added = addScopeItem('c1', { type: 'cloud_account', value: ' 111111111111 ', source: 'user' })
    expect(added.id).toBeTruthy()
    expect(added.value).toBe('111111111111')     // trimmed
    const scope = getProjectScope('c1')
    expect(scope.items).toHaveLength(1)
    removeScopeItem('c1', added.id)
    expect(getProjectScope('c1').items).toEqual([])
  })

  it('notes persist per company', () => {
    expect(getProjectScope('c1').notes).toBe('')
    setScopeNotes('c1', 'No DoS. Business hours only.')
    expect(getProjectScope('c1').notes).toBe('No DoS. Business hours only.')
    expect(getProjectScope('c2').notes).toBe('')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/scope.project.test.ts`
Expected: FAIL — new exports are undefined.

- [ ] **Step 3: Expand `Target` and add the project-scope functions to `scope.ts`**

Change the imports at the top of `scope.ts` (lines 1-2) to:

```ts
import { randomUUID } from 'node:crypto'
import { getScopeRow, setScopeRow, getSetting, setSetting, insertScopeItem, deleteScopeItem, listScopeItems } from './store.sqlite'
import type { EngagementScope, ProjectScope, ScopeItem, ScopeItemType } from './store.types'
```

Replace the existing `Target` interface (line 16) with the expanded version and add `ScopeDecision`:

```ts
export interface Target { account?: string; region?: string; ip?: string; hostname?: string; url?: string }
export interface Decision { allowed: boolean; reason?: string }
export interface ScopeDecision { allowed: boolean; reason?: string; propose?: { type: ScopeItemType; value: string } }
```

Append the project-scope service + matcher to the END of `scope.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/scope.project.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add electron/services/scope.ts test/scope.project.test.ts
git commit -m "feat(scope): project-scope service + matchesScope gate primitive"
```

---

### Task 3: `projectScope` IPC surface (preload + main + types)

**Files:**
- Modify: `electron/preload.ts` (add `projectScope` namespace after the existing `scope` block ~line 48)
- Modify: `electron/main.ts` (import service fns; add handlers after the scope handlers ~line 113)
- Modify: `src/global.d.ts` (add `projectScope` to `NexraApi`; import `ProjectScope`, `ScopeItem`, `ScopeItemType`)
- Test: `test/projectScope.ipc.test.ts` (create — main-handler smoke test via the service)

**Interfaces:**
- Consumes: `getProjectScope`/`addScopeItem`/`removeScopeItem`/`setScopeNotes` (Task 2).
- Produces: `window.nexra.projectScope.{ get, add, remove, setNotes }`.

- [ ] **Step 1: Add the preload namespace**

In `electron/preload.ts`, after the `scope` object (line 48, before `findings:`), add:

```ts
  projectScope: {
    get: (companyId: string) => ipcRenderer.invoke('projectScope:get', companyId),
    add: (companyId: string, input: { type: string; value: string; source: 'user' | 'agent' }) => ipcRenderer.invoke('projectScope:add', { companyId, input }),
    remove: (companyId: string, id: string) => ipcRenderer.invoke('projectScope:remove', { companyId, id }),
    setNotes: (companyId: string, notes: string) => ipcRenderer.invoke('projectScope:set-notes', { companyId, notes }),
  },
```

- [ ] **Step 2: Add the main handlers**

In `electron/main.ts`, extend the scope import on line 11:

```ts
import { getScope, setScope, getProjectScope, addScopeItem, removeScopeItem, setScopeNotes } from './services/scope'
```

Add a `ScopeItemType` import to line 14:

```ts
import type { EngagementScope, SecretField, Company, ScopeItemType } from './services/store.types'
```

After the `scope:set` handler (line 113), add:

```ts
  // ── project scope (company-shared, enforced) ──
  ipcMain.handle('projectScope:get', (_ev, companyId: string) => getProjectScope(companyId))
  ipcMain.handle('projectScope:add', (_ev, { companyId, input }: { companyId: string; input: { type: ScopeItemType; value: string; source: 'user' | 'agent' } }) => addScopeItem(companyId, input))
  ipcMain.handle('projectScope:remove', (_ev, { companyId, id }: { companyId: string; id: string }) => removeScopeItem(companyId, id))
  ipcMain.handle('projectScope:set-notes', (_ev, { companyId, notes }: { companyId: string; notes: string }) => setScopeNotes(companyId, notes))
```

- [ ] **Step 3: Add the `NexraApi` typing**

In `src/global.d.ts`, extend the type import on line 1 to include the new types:

```ts
import type { Snapshot, Secret, SecretField, EngagementScope, Finding, ProjectScope, ScopeItem, ScopeItemType } from '../electron/services/store.types'
```

After the `scope` interface block (line 44), add:

```ts
  projectScope: {
    get(companyId: string): Promise<ProjectScope>
    add(companyId: string, input: { type: ScopeItemType; value: string; source: 'user' | 'agent' }): Promise<ScopeItem>
    remove(companyId: string, id: string): Promise<void>
    setNotes(companyId: string, notes: string): Promise<void>
  }
```

- [ ] **Step 4: Write and run a service-level smoke test**

Create `test/projectScope.ipc.test.ts` (the IPC layer is a thin pass-through; assert the service contract the handlers call):

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initSettingsDb } from '../electron/services/store.sqlite'
import { getProjectScope, addScopeItem, removeScopeItem, setScopeNotes } from '../electron/services/scope'

describe('projectScope IPC contract (service pass-through)', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-pscope-ipc-')); initSettingsDb(join(dir, 'nexra.db')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('add → get → set-notes → remove behaves as the handlers expect', () => {
    const added = addScopeItem('c1', { type: 'hostname', value: 'app.acme.com', source: 'agent' })
    setScopeNotes('c1', 'rules')
    let scope = getProjectScope('c1')
    expect(scope.items.map(i => i.value)).toEqual(['app.acme.com'])
    expect(scope.items[0].source).toBe('agent')
    expect(scope.notes).toBe('rules')
    removeScopeItem('c1', added.id)
    scope = getProjectScope('c1')
    expect(scope.items).toEqual([])
    expect(scope.notes).toBe('rules')
  })
})
```

Run: `npx vitest run test/projectScope.ipc.test.ts` → Expected: PASS.
Run: `npm run typecheck` → Expected: no errors (new preload/main/global.d.ts compile).

- [ ] **Step 5: Commit**

```bash
git add electron/preload.ts electron/main.ts src/global.d.ts test/projectScope.ipc.test.ts
git commit -m "feat(scope): projectScope IPC namespace (get/add/remove/setNotes)"
```

---

### Task 4: Rewire the tool gate to project scope + emit `scope_proposal`

**Files:**
- Modify: `electron/services/agent.types.ts` (add `scope_proposal` event ~line 18)
- Modify: `electron/services/agent.tools.ts` (change `RunDeps.getScope`; replace gates 1+2 with a single `matchesScope` gate that proposes on failure)
- Modify: `electron/services/agent.live.ts` (wire `getProjectScope` into `deps`; import update)
- Modify: `test/agent.tools.test.ts` (update `getScope` fakes + out-of-scope/no-scope expectations)
- Modify: `test/m3b-integration.test.ts` (update scope setup)
- Modify: `test/agent.live.coverage.test.ts` (update scope setup)

**Interfaces:**
- Consumes: `matchesScope`/`getProjectScope`/`Target` (Task 2), `ProjectScope` (Task 1).
- Produces:
  - `AgentEvent` variant `{ type: 'scope_proposal'; companyId: string; item: { type: ScopeItemType; value: string }; reason?: string }`
  - `RunDeps.getScope(companyId: string): ProjectScope`
  - `runSkill` returns `{ state: 'blocked', reason: 'awaiting-scope' }` and emits `scope_proposal` for an out-of-scope target that has a proposable value; `{ state: 'denied' }` only when nothing is proposable.

- [ ] **Step 1: Add the `scope_proposal` event type**

In `electron/services/agent.types.ts`, add `ScopeItemType` to the import on line 1:

```ts
import type { Severity, ToolState, Evidence, InputRequestItem, ScopeItemType } from './store.types'
```

Add the event variant after the `scope_request` line (line 18):

```ts
  | { type: 'scope_proposal'; companyId: string; item: { type: ScopeItemType; value: string }; reason?: string }
```

- [ ] **Step 2: Update the failing gate tests**

In `test/agent.tools.test.ts`:

Replace the import on line 6:

```ts
import type { ProjectScope } from '../electron/services/store.types'
```

Replace `baseDeps`'s `getScope` (line 19) so the fake returns an allowing `ProjectScope` for the probe's account:

```ts
    getScope: (): ProjectScope => ({ companyId: 'c1', notes: '', items: [{ id: 's1', type: 'cloud_account', value: '111111111111', source: 'user', addedAt: 0 }] }),
```

Replace the "denies an out-of-scope target" test (lines 49-60) with:

```ts
  it('proposes (and blocks, never spawns) an out-of-scope target', async () => {
    const spy = vi.fn(nodeSpawn)
    const { events, emit } = collect()
    const scope: ProjectScope = { companyId: 'c1', notes: '', items: [{ id: 's1', type: 'cloud_account', value: '111111111111', source: 'user', addedAt: 0 }] }
    const result = await runSkill(
      { ...inv, account: '999999999999' }, probeSkill, emit,
      baseDeps({ getScope: () => scope, spawn: spy as any }),
    )
    expect(result.state).toBe('blocked')
    expect(spy).not.toHaveBeenCalled()
    const proposal = events.find(e => e.type === 'scope_proposal') as any
    expect(proposal.item).toEqual({ type: 'cloud_account', value: '999999999999' })
  })
```

Replace the "blocks (and requests scope) when no scope record exists" test (lines 118-126) with:

```ts
  it('proposes the target when scope is empty — the gate, never spawns', async () => {
    const spy = vi.fn(nodeSpawn)
    const { events, emit } = collect()
    const empty: ProjectScope = { companyId: 'c1', notes: '', items: [] }
    const result = await runSkill(inv, probeSkill, emit, baseDeps({ getScope: () => empty, spawn: spy as any }))
    expect(result).toEqual({ state: 'blocked', reason: 'awaiting-scope' })
    expect(spy).not.toHaveBeenCalled()
    expect(events.some(e => e.type === 'scope_proposal')).toBe(true)
  })
```

In `test/m3b-integration.test.ts`: delete the `import { setScope }` line (line 7) and the `setScope('eng-1', …)` call (line 34); replace both `deps` `getScope` fakes (lines 45 and 65) with:

```ts
      getScope: () => ({ companyId: 'c-1', notes: '', items: [{ id: 's1', type: 'cloud_account', value: '111', source: 'user', addedAt: 0 }] }),
```

(The invocation account is `'111'`, so the item value must be `'111'`.)

In `test/agent.live.coverage.test.ts`: replace the import on line 11 with `import { addScopeItem } from '../electron/services/scope'`, and replace the `setScope('eng-1', …)` call (line 35) with:

```ts
    addScopeItem('co-1', { type: 'cloud_account', value: '111111111111', source: 'user' })
```

(`runSend` is called with companyId `'co-1'`; the probe uses `account=111111111111`.)

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/agent.tools.test.ts`
Expected: FAIL — `runSkill` still emits `denied`/`scope_request`, not `scope_proposal`/`blocked`.

- [ ] **Step 4: Rewire `agent.tools.ts`**

Change the imports (lines 4-5):

```ts
import type { ProjectScope } from './store.types'
import { matchesScope, type Target } from './scope'
```

Change `RunDeps.getScope` (line 32) to be company-keyed and return a `ProjectScope`:

```ts
  getScope(companyId: string): ProjectScope
```

Replace gate 1 + gate 2 (lines 74-87) with a single scope gate:

```ts
  // Gate — target must be authorized by the project scope (below the LLM;
  // never spawns). Instead of a dead-end refusal, an out-of-scope target with
  // a proposable value emits a scope_proposal + blocks (the operator confirms,
  // then the run resumes). Only a target with nothing to propose hard-denies.
  const scope = deps.getScope(inv.companyId)
  const target: Target = { account: inv.account, region: inv.region, ip: inv.ip, hostname: inv.hostname, url: inv.url }
  const decision = matchesScope(target, scope)
  if (!decision.allowed) {
    if (decision.propose) {
      emit({ type: 'scope_proposal', companyId: inv.companyId, item: decision.propose, reason: decision.reason })
      emit({ type: 'skill', id, skill: def.name, state: 'blocked', message: decision.reason })
      return Promise.resolve({ state: 'blocked', reason: 'awaiting-scope' })
    }
    emit({ type: 'skill', id, skill: def.name, state: 'denied', message: decision.reason })
    return Promise.resolve({ state: 'denied', reason: decision.reason ?? 'out of scope' })
  }
```

- [ ] **Step 5: Wire `getProjectScope` into `agent.live.ts`**

Change the import on line 7:

```ts
import { getProjectScope } from './scope'
```

Change the `deps` construction (line 149):

```ts
          const deps: RunDeps = { getScope: getProjectScope, injectEnv, filledEnvVars }
```

(`inv` already carries `companyId`; the `blocked` outcome branch in `agent.live.ts` lines 164-169 already pauses the turn — `awaiting-scope` reuses it unchanged.)

- [ ] **Step 6: Run the affected suites**

Run: `npx vitest run test/agent.tools.test.ts test/m3b-integration.test.ts test/agent.live.coverage.test.ts`
Expected: PASS.
Run: `npm run typecheck` → Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add electron/services/agent.types.ts electron/services/agent.tools.ts electron/services/agent.live.ts test/agent.tools.test.ts test/m3b-integration.test.ts test/agent.live.coverage.test.ts
git commit -m "feat(scope): enforce project scope in the tool gate; propose out-of-scope targets"
```

---

### Task 5: `propose_scope_item` agent skill

**Files:**
- Modify: `electron/services/agent.live.ts` (system prompt line ~62; add a `propose_scope_item` branch in the skill loop ~line 112)
- Test: `test/agent.live.scope.test.ts` (create)

**Interfaces:**
- Consumes: the `scope_proposal` event (Task 4); `parseSkillCalls` (existing).
- Produces: on `SKILL_CALL[propose_scope_item|type=…|value=…|reason=…]` with an engagement context, emits `scope_proposal` and pauses the turn (like `request_inputs`).

- [ ] **Step 1: Write the failing test**

Create `test/agent.live.scope.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const streamText = vi.fn()
vi.mock('ai', () => ({ streamText: (o: any) => streamText(o) }))
vi.mock('../electron/services/providers', () => ({ resolveModel: () => ({ tag: 'fake-model' }) }))

import { initSettingsDb } from '../electron/services/store.sqlite'
import { runSend } from '../electron/services/agent.live'
import type { AgentEvent, AgentSendRequest } from '../electron/services/agent.types'
import type { ProviderConfig } from '../electron/services/providers'

const fakeStream = (parts: string[]) => ({ textStream: (async function* () { for (const p of parts) yield p })(), usage: Promise.resolve({ totalTokens: 1 }) })
const req: AgentSendRequest = { chatId: 'chat-1', engagementType: 'external', phaseLabel: 'Recon', text: 'recon', history: [] }
const cfg: ProviderConfig = { provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'sk-1' }

let dir: string
beforeEach(() => { streamText.mockReset(); dir = mkdtempSync(join(tmpdir(), 'nexra-alscope-')); initSettingsDb(join(dir, 'nexra.db')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('propose_scope_item', () => {
  it('emits a scope_proposal and pauses the turn (no second model step)', async () => {
    streamText.mockReturnValueOnce(fakeStream(['Found a new host. SKILL_CALL[propose_scope_item|type=hostname|value=admin.acme.com|reason=discovered in DNS]']))
    const events: AgentEvent[] = []
    await runSend(req, cfg, e => events.push(e), new AbortController().signal, 'co-1', 'eng-1')

    const proposal = events.find(e => e.type === 'scope_proposal') as any
    expect(proposal).toBeTruthy()
    expect(proposal.item).toEqual({ type: 'hostname', value: 'admin.acme.com' })
    expect(proposal.companyId).toBe('co-1')
    expect(streamText).toHaveBeenCalledTimes(1)   // paused, did not continue
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/agent.live.scope.test.ts`
Expected: FAIL — `propose_scope_item` is treated as an unknown skill and does not emit `scope_proposal`.

- [ ] **Step 3: Add the skill branch in `agent.live.ts`**

Add a `ScopeItemType` import to line 4:

```ts
import type { Finding, InputRequestItem, ScopeItemType } from './store.types'
```

Add this constant above `runSend` (near line 15, after `interface DetectedSkill`):

```ts
const SCOPE_ITEM_TYPES: ScopeItemType[] = ['cidr', 'ip', 'hostname', 'url', 'cloud_account', 'tenant_id', 'region', 'other']
```

Inside the `for (const c of calls)` loop, add this branch immediately after the `request_inputs` branch (after line 117):

```ts
        if (c.name === 'propose_scope_item') {
          const rawType = (c.args.type ?? '').trim() as ScopeItemType
          const type: ScopeItemType = SCOPE_ITEM_TYPES.includes(rawType) ? rawType : 'other'
          const value = (c.args.value ?? '').trim()
          if (value && companyId) {
            emit({ type: 'scope_proposal', companyId, item: { type, value }, reason: c.args.reason })
            requestedInputs = true
          }
          continue
        }
```

- [ ] **Step 4: Advertise the skill in the system prompt**

In `systemPrompt` (line 62), append this bullet to the `skills` template string (after the `request_inputs` bullet, before the closing backtick):

```
- propose_scope_item|type=TYPE|value=VALUE|reason=TEXT: Propose adding a newly discovered asset to the shared project scope for the operator to confirm. TYPE is one of cidr, ip, hostname, url, cloud_account, tenant_id, region, other. The run pauses until the operator accepts or declines; only accepted items become authorized. Use this when you find an in-scope-looking asset that is not yet listed — do NOT act on it until it is confirmed.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/agent.live.scope.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/services/agent.live.ts test/agent.live.scope.test.ts
git commit -m "feat(scope): propose_scope_item agent skill"
```

---

### Task 6: Renderer event plumbing — reducer, ipc mapping, message persistence

**Files:**
- Modify: `electron/services/store.types.ts` (extend `Message.requestKind`; add `proposeItem`)
- Modify: `electron/services/store.sqlite.ts` (add `scope_item` column via additive ALTER; extend the `messages` CREATE)
- Modify: `electron/services/store.graph.ts` (persist/read `proposeItem`)
- Modify: `src/state/reducer.ts` (add `appendScopeProposal` action + case; import `ScopeItemType`)
- Modify: `src/ipc.ts` (map `scope_proposal` event → `appendScopeProposal`)
- Modify: `test/reducer.test.ts` (add an `appendScopeProposal` test)
- Modify: `test/ipc.test.ts` (add a `scope_proposal` mapping assertion)
- Test: `test/store.graph.scope.test.ts` (create — proposeItem round-trips)

**Interfaces:**
- Consumes: `scope_proposal` event (Task 4).
- Produces:
  - `Message.requestKind` includes `'scope_proposal'`; `Message.proposeItem?: { type: ScopeItemType; value: string }`.
  - reducer action `{ t: 'appendScopeProposal'; chatId: string; item: { type: ScopeItemType; value: string }; reason?: string }`.

- [ ] **Step 1: Extend the `Message` type**

In `electron/services/store.types.ts`, change line 26 to:

```ts
  requestKind?: 'inputs' | 'scope' | 'scope_proposal'; requestId?: string; items?: InputRequestItem[]; engagementId?: string
  proposeItem?: { type: ScopeItemType; value: string }
```

- [ ] **Step 2: Write the failing reducer + graph tests**

Add to `test/reducer.test.ts` (inside the same `describe` that holds the `appendScopeRequest` test, after line 278):

```ts
  it('appendScopeProposal pushes a scope-proposal request message', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const chatId = activeEngagement(s)!.chats[0].id
    s = reducer(s, { t: 'appendScopeProposal', chatId, item: { type: 'hostname', value: 'admin.acme.com' }, reason: 'discovered' })
    const msgs = chatByGlobalId(s, chatId)!.messages
    const msg = msgs[msgs.length - 1]
    expect(msg.kind).toBe('request')
    expect(msg.requestKind).toBe('scope_proposal')
    expect(msg.proposeItem).toEqual({ type: 'hostname', value: 'admin.acme.com' })
    expect(msg.reason).toBe('discovered')
  })
```

Create `test/store.graph.scope.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initSettingsDb } from '../electron/services/store.sqlite'
import { saveGraph, readGraph } from '../electron/services/store.graph'
import type { Company } from '../electron/services/store.types'

const companies: Company[] = [{
  id: 'c1', name: 'Acme', updated: 'now',
  engagements: [{
    id: 'e1', type: 'external', name: 'Ext', status: 'In Progress', updated: 'now', linear: true,
    phases: [{ id: 'recon', label: 'Recon' }], scope: [],
    chats: [{
      id: 'ch1', name: 'Recon', phaseId: 'recon', color: '#000', findings: [],
      messages: [{ id: 'm1', role: 'assistant', kind: 'request', requestKind: 'scope_proposal', proposeItem: { type: 'hostname', value: 'admin.acme.com' }, reason: 'dns' }],
    }],
  }],
}]

describe('scope_proposal message persistence', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-graph-scope-')); initSettingsDb(join(dir, 'nexra.db')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('round-trips proposeItem through save/read', () => {
    saveGraph(companies)
    const msg = readGraph()[0].engagements[0].chats[0].messages[0]
    expect(msg.requestKind).toBe('scope_proposal')
    expect(msg.proposeItem).toEqual({ type: 'hostname', value: 'admin.acme.com' })
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/reducer.test.ts test/store.graph.scope.test.ts`
Expected: FAIL — `appendScopeProposal` action and `proposeItem` persistence do not exist yet.

- [ ] **Step 4: Add the `scope_item` column + ALTER in `store.sqlite.ts`**

Add `scope_item TEXT` to the `messages` CREATE (line 87), so the column list ends:

```ts
    request_kind TEXT, request_id TEXT, items TEXT, engagement_id TEXT, scope_item TEXT, ord INTEGER NOT NULL
```

Add an additive migration for existing DBs right after the `messages` CREATE (after line 88), mirroring the `secrets.sensitive` ALTER pattern:

```ts
  // Additive migration: older DBs created `messages` without scope_item.
  try { db.exec('ALTER TABLE messages ADD COLUMN scope_item TEXT') } catch { /* column already present */ }
```

- [ ] **Step 5: Persist/read `proposeItem` in `store.graph.ts`**

In `saveGraph`'s `upMsg` statement (lines 29-38): add `scope_item` to the column list, the values list, and the `ON CONFLICT` update:

- column list (line 31): `… engagement_id, scope_item, ord)`
- values (line 33): `… @engagement_id, @scope_item, @ord)`
- conflict update (line 38): `… engagement_id=excluded.engagement_id, scope_item=excluded.scope_item, ord=excluded.ord`

In the `upMsg.run({...})` payload (lines 51-55), add:

```ts
              scope_item: m.proposeItem ? JSON.stringify(m.proposeItem) : null,
```

Add `scope_item` to the `MsgRow` interface (lines 67-71):

```ts
  request_kind: string | null; request_id: string | null; items: string | null; engagement_id: string | null; scope_item: string | null
```

In `rowToMessage` (after line 86, before `return m`):

```ts
  if (r.scope_item != null) m.proposeItem = JSON.parse(r.scope_item) as Message['proposeItem']
```

(The `readGraph` `msgStmt` uses `SELECT *`, so the new column is already fetched.)

- [ ] **Step 6: Add the reducer action + case**

In `src/state/reducer.ts`, add `ScopeItemType` to the type import on line 4:

```ts
import type { Chat, Message, Finding, Phase, EngagementScope, InputRequestItem, ScopeItemType } from '../../electron/services/store.types'
```

Add the action to the `Action` union after `appendScopeRequest` (line 121):

```ts
  | { t: 'appendScopeProposal'; chatId: string; item: { type: ScopeItemType; value: string }; reason?: string }
```

Add the case after the `appendScopeRequest` case (after line 300):

```ts
    case 'appendScopeProposal': {
      const c = chatByGlobalId(s, a.chatId); if (!c) return state
      c.messages.push({ id: nextId('m'), role: 'assistant', kind: 'request', requestKind: 'scope_proposal', proposeItem: a.item, reason: a.reason })
      return s
    }
```

- [ ] **Step 7: Map the event in `src/ipc.ts`**

Add a case after the `scope_request` case (after line 52) in `applyEvent`:

```ts
      case 'scope_proposal':
        dispatch({ t: 'appendScopeProposal', chatId, item: e.item, reason: e.reason })
        break
```

Add to `test/ipc.test.ts`, inside the existing "maps input_request / scope_request / skill events" test (after line 108) a proposal event + assertion:

```ts
    sent!.onEvent({ type: 'scope_proposal', companyId: 'co1', item: { type: 'ip', value: '10.0.0.9' }, reason: 'r' })
```
and after line 111:
```ts
    expect(dispatched).toContainEqual({ t: 'appendScopeProposal', chatId: 'c1', item: { type: 'ip', value: '10.0.0.9' }, reason: 'r' })
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run test/reducer.test.ts test/store.graph.scope.test.ts test/ipc.test.ts`
Expected: PASS.
Run: `npm run typecheck` → Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add electron/services/store.types.ts electron/services/store.sqlite.ts electron/services/store.graph.ts src/state/reducer.ts src/ipc.ts test/reducer.test.ts test/ipc.test.ts test/store.graph.scope.test.ts
git commit -m "feat(scope): scope_proposal message plumbing + persistence"
```

---

### Task 7: UI — proposal card, ScopePanel, and resume wiring

**Files:**
- Create: `src/components/ScopePanel.tsx`
- Modify: `src/components/RequestCard.tsx` (add `onScopeResolve` prop + `scope_proposal` variant)
- Modify: `src/components/MessageList.tsx` (thread `onScopeResolve` to `RequestCard`)
- Modify: `src/components/ChatPane.tsx` (pass `onScopeResolve` → `resumeAfterScope`)
- Modify: `src/ipc.ts` (DRY `resumeAfterInputs`; add `resumeAfterScope`)
- Modify: `src/components/ContextPanel.tsx` (render `<ScopePanel>` in the scope tab)
- Modify: `test/ContextPanel.test.tsx` (mock `window.nexra.projectScope`)
- Test: `test/ScopePanel.test.tsx` (create), extend `test/RequestCard.test.tsx`

**Interfaces:**
- Consumes: `window.nexra.projectScope.*` (Task 3), `Message.proposeItem` (Task 6), `appendScopeProposal` (Task 6).
- Produces: `resumeAfterScope(dispatch, chat, eng, companyId, outcome: 'added'|'declined')`.

- [ ] **Step 1: Write the failing ScopePanel test**

Create `test/ScopePanel.test.tsx`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ScopePanel } from '../src/components/ScopePanel'

beforeEach(() => {
  ;(window as any).nexra = {
    projectScope: {
      get: vi.fn(() => Promise.resolve({ companyId: 'c1', notes: 'be careful', items: [
        { id: 'i1', type: 'cloud_account', value: '111111111111', source: 'user', addedAt: 1 },
        { id: 'i2', type: 'hostname', value: 'admin.acme.com', source: 'agent', addedAt: 2 },
      ] })),
      add: vi.fn((_c: string, input: any) => Promise.resolve({ id: 'i3', ...input, addedAt: 3 })),
      remove: vi.fn(() => Promise.resolve()),
      setNotes: vi.fn(() => Promise.resolve()),
    },
  }
})

describe('ScopePanel', () => {
  it('lists items and notes for the company', async () => {
    render(<ScopePanel companyId="c1" />)
    expect(await screen.findByText('111111111111')).toBeTruthy()
    expect(screen.getByText('admin.acme.com')).toBeTruthy()
    expect((screen.getByDisplayValue('be careful'))).toBeTruthy()
    expect((window as any).nexra.projectScope.get).toHaveBeenCalledWith('c1')
  })

  it('adds an item through the IPC bridge', async () => {
    render(<ScopePanel companyId="c1" />)
    await screen.findByText('111111111111')
    fireEvent.change(screen.getByLabelText('New scope value'), { target: { value: '10.0.0.0/8' } })
    fireEvent.change(screen.getByLabelText('New scope type'), { target: { value: 'cidr' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect((window as any).nexra.projectScope.add).toHaveBeenCalledWith('c1', { type: 'cidr', value: '10.0.0.0/8', source: 'user' }))
  })

  it('removes an item through the IPC bridge', async () => {
    render(<ScopePanel companyId="c1" />)
    await screen.findByText('admin.acme.com')
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove scope item' })[1])
    await waitFor(() => expect((window as any).nexra.projectScope.remove).toHaveBeenCalledWith('c1', 'i2'))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/ScopePanel.test.tsx`
Expected: FAIL — `ScopePanel` does not exist.

- [ ] **Step 3: Create `ScopePanel.tsx`**

Mirror `SecretsPanel.tsx`'s IPC-fetch pattern and `ContextPanel`'s existing scope-tab styling (card list at `theme.card`, borders `theme.border`, mono values). Provenance dot: `theme.accent` for `agent`, `theme.dim2` for `user`.

```tsx
import { useState, useEffect } from 'react'
import type { ProjectScope, ScopeItem, ScopeItemType } from '../../electron/services/store.types'
import { theme } from '../theme'
import { Hoverable } from './Hoverable'

const TYPES: ScopeItemType[] = ['cidr', 'ip', 'hostname', 'url', 'cloud_account', 'tenant_id', 'region', 'other']
const PLACEHOLDER: Record<ScopeItemType, string> = {
  cidr: '10.0.0.0/24', ip: '10.0.0.5', hostname: 'app.acme.com', url: 'https://app.acme.com',
  cloud_account: '111111111111', tenant_id: 'contoso.onmicrosoft.com', region: 'us-east-1', other: 'note',
}

export function ScopePanel({ companyId }: { companyId: string }) {
  const [scope, setScope] = useState<ProjectScope>({ companyId, items: [], notes: '' })
  const [loading, setLoading] = useState(true)
  const [type, setType] = useState<ScopeItemType>('cloud_account')
  const [value, setValue] = useState('')

  useEffect(() => {
    let live = true
    window.nexra.projectScope.get(companyId).then(s => { if (live) { setScope(s); setLoading(false) } })
    return () => { live = false }
  }, [companyId])

  const add = async () => {
    const v = value.trim()
    if (!v) return
    const item = await window.nexra.projectScope.add(companyId, { type, value: v, source: 'user' })
    setScope(s => ({ ...s, items: [...s.items, item] }))
    setValue('')
  }
  const remove = async (id: string) => {
    await window.nexra.projectScope.remove(companyId, id)
    setScope(s => ({ ...s, items: s.items.filter(i => i.id !== id) }))
  }
  const saveNotes = (notes: string) => {
    setScope(s => ({ ...s, notes }))
    window.nexra.projectScope.setNotes(companyId, notes)
  }

  if (loading) return <div style={{ padding: '12px', color: theme.dim }}>Loading scope…</div>

  const dot = (i: ScopeItem) => (i.source === 'agent' ? theme.accent : theme.dim2)

  return (
    <>
      <div style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: '0.1em', color: theme.dim2, textTransform: 'uppercase', marginBottom: 10 }}>Scope</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 9, overflow: 'hidden', marginBottom: 12 }}>
        {scope.items.length === 0 && <div style={{ padding: '10px 12px', fontSize: 11.5, color: theme.dim2 }}>No scope yet. Add an authorized target below.</div>}
        {scope.items.map(i => (
          <div key={i.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '9px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <span title={i.source === 'agent' ? 'Added by agent' : 'Added by you'} style={{ flex: 'none', width: 7, height: 7, borderRadius: '50%', background: dot(i) }} />
            <span style={{ flex: 'none', width: 82, fontSize: 11.5, color: theme.dim }}>{i.type}</span>
            <span style={{ flex: 1, fontFamily: theme.mono, fontSize: 11.5, color: theme.textDim, wordBreak: 'break-word' }}>{i.value}</span>
            <Hoverable as="button" type="button" title="Remove scope item" aria-label="Remove scope item" onClick={() => remove(i.id)}
              baseStyle={{ flex: 'none', width: 20, height: 20, borderRadius: 5, border: 'none', background: 'transparent', color: theme.dim2, cursor: 'pointer', fontSize: 13 }}
              hoverStyle={{ color: '#f0616d', background: 'rgba(240,97,109,0.1)' }}>×</Hoverable>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
        <select aria-label="New scope type" value={type} onChange={e => setType(e.target.value as ScopeItemType)}
          style={{ flex: 'none', padding: '6px', background: theme.input, border: `1px solid ${theme.border}`, borderRadius: 4, color: theme.text, fontSize: 11.5 }}>
          {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input aria-label="New scope value" value={value} onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add() }} placeholder={PLACEHOLDER[type]}
          style={{ flex: 1, minWidth: 0, padding: '6px', background: theme.input, border: `1px solid ${theme.border}`, borderRadius: 4, color: theme.text, fontFamily: theme.mono, fontSize: 11.5 }} />
        <button type="button" onClick={add}
          style={{ flex: 'none', padding: '6px 10px', background: theme.accent, color: theme.bg, border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11.5 }}>Add</button>
      </div>

      <div style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: '0.1em', color: theme.dim2, textTransform: 'uppercase', marginBottom: 10 }}>Notes</div>
      <textarea aria-label="Scope notes" value={scope.notes} onChange={e => saveNotes(e.target.value)}
        placeholder="Rules of engagement, exclusions, caveats…"
        style={{ width: '100%', minHeight: 90, resize: 'vertical', padding: '8px 10px', background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 9, color: theme.textDim, fontSize: 12, lineHeight: 1.5, boxSizing: 'border-box' }} />
    </>
  )
}
```

Note: confirm `theme.input`, `theme.card`, `theme.border`, `theme.textDim`, `theme.dim`, `theme.dim2`, `theme.accent`, `theme.bg`, `theme.mono`, `theme.text` exist in `src/theme.ts` (all are already used by `ContextPanel.tsx`/`RequestCard.tsx`). If any token is missing, use the one `ContextPanel.tsx` uses for the same purpose.

- [ ] **Step 4: Run the ScopePanel test to verify it passes**

Run: `npx vitest run test/ScopePanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire `ScopePanel` into `ContextPanel.tsx`**

Add the import near line 3:

```ts
import { ScopePanel } from './ScopePanel'
```

Delete the now-unused `const scope = eng!.scope` (line 40). Replace the entire scope-tab block (lines 86-98) with:

```tsx
        {tab === 'scope' && company && <ScopePanel companyId={company.id} />}
```

- [ ] **Step 6: Update `ContextPanel.test.tsx` to mock projectScope**

The default tab is `scope`, which now mounts `ScopePanel` (an IPC fetch). In `mountWithFindings` (before the `render`, ~line 15) and in the secrets test's `window.nexra` assignment (line 42), add a `projectScope` mock so the default tab doesn't throw:

In `mountWithFindings`, before `return render(...)`:
```ts
  ;(window as any).nexra = { ...(window as any).nexra, projectScope: { get: () => Promise.resolve({ companyId: 'c1', items: [], notes: '' }) } }
```
In the secrets test, change line 42 to:
```ts
    ;(window as any).nexra = { secrets: { list }, projectScope: { get: () => Promise.resolve({ companyId: 'c1', items: [], notes: '' }) } }
```

Run: `npx vitest run test/ContextPanel.test.tsx` → Expected: PASS.

- [ ] **Step 7: Add the `scope_proposal` RequestCard variant (write the failing test first)**

Add to `test/RequestCard.test.tsx`:

```ts
it('scope_proposal: prefills the proposed item, adds on confirm, resumes with "added"', async () => {
  const add = vi.fn(() => Promise.resolve({ id: 'i9' }))
  ;(window as any).nexra = { projectScope: { add } }
  const onScopeResolve = vi.fn()
  const msg = { id: 'p1', role: 'assistant', kind: 'request', requestKind: 'scope_proposal', proposeItem: { type: 'hostname', value: 'admin.acme.com' } }
  render(<RequestCard message={msg} companyId="co1" onFulfill={() => {}} onScopeResolve={onScopeResolve} />)
  expect((screen.getByLabelText('Proposed scope value') as HTMLInputElement).value).toBe('admin.acme.com')
  fireEvent.click(screen.getByRole('button', { name: 'Add to scope' }))
  await waitFor(() => expect(add).toHaveBeenCalledWith('co1', { type: 'hostname', value: 'admin.acme.com', source: 'agent' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Continue' }))
  expect(onScopeResolve).toHaveBeenCalledWith('added')
})

it('scope_proposal: Decline resumes with "declined" and does not add', () => {
  const add = vi.fn()
  ;(window as any).nexra = { projectScope: { add } }
  const onScopeResolve = vi.fn()
  const msg = { id: 'p2', role: 'assistant', kind: 'request', requestKind: 'scope_proposal', proposeItem: { type: 'ip', value: '10.0.0.9' } }
  render(<RequestCard message={msg} companyId="co1" onFulfill={() => {}} onScopeResolve={onScopeResolve} />)
  fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
  expect(add).not.toHaveBeenCalled()
  expect(onScopeResolve).toHaveBeenCalledWith('declined')
})
```

Add `waitFor` to the testing-library import at the top of `test/RequestCard.test.tsx` (line 2): `import { render, screen, fireEvent, waitFor } from '@testing-library/react'`.

Run: `npx vitest run test/RequestCard.test.tsx` → Expected: FAIL (variant + prop don't exist).

- [ ] **Step 8: Implement the RequestCard variant**

In `src/components/RequestCard.tsx`, add `ScopeItemType` to the type import (line 2) and extend the props (lines 5-9):

```ts
import type { EngagementScope, SecretField, InputRequestItem, ScopeItemType } from '../../electron/services/store.types'
```
```ts
export interface RequestCardProps {
  message: any
  companyId?: string
  onFulfill: () => void
  onScopeResolve?: (outcome: 'added' | 'declined') => void
}
export function RequestCard({ message, companyId, onFulfill, onScopeResolve }: RequestCardProps) {
```

Add this variant just before the final `return null` (line 210):

```tsx
  if (message.requestKind === 'scope_proposal') {
    const proposed = (message.proposeItem ?? { type: 'other', value: '' }) as { type: ScopeItemType; value: string }
    const TYPES: ScopeItemType[] = ['cidr', 'ip', 'hostname', 'url', 'cloud_account', 'tenant_id', 'region', 'other']
    const [type, setType] = useState<ScopeItemType>(proposed.type)
    const [value, setValue] = useState(proposed.value)
    const [added, setAdded] = useState(false)
    const resolvedRef = useRef(false)

    const handleAdd = async () => {
      if (!value.trim()) return
      setLoading(true)
      try {
        await window.nexra.projectScope.add(companyId!, { type, value: value.trim(), source: 'agent' })
        setAdded(true)
      } catch (err) { setError((err as Error).message) } finally { setLoading(false) }
    }
    const resolve = (outcome: 'added' | 'declined') => {
      if (resolvedRef.current) return
      resolvedRef.current = true
      onScopeResolve?.(outcome)
    }

    return (
      <div style={{ background: theme.card, border: `1px solid ${theme.accent}`, borderRadius: '6px', padding: '12px', marginTop: '8px' }}>
        <div style={{ fontWeight: 500, marginBottom: '8px' }}>Add to scope?</div>
        {message.reason && <div style={{ fontSize: '12px', color: theme.muted, marginBottom: '8px' }}>{message.reason}</div>}
        {error && <div style={{ color: '#f0616d', fontSize: '12px', marginBottom: '8px' }}>{error}</div>}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
          <select aria-label="Proposed scope type" value={type} onChange={e => setType(e.target.value as ScopeItemType)} disabled={added}
            style={{ flex: 'none', padding: '6px', background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: '4px', color: theme.text, fontSize: '12px' }}>
            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input aria-label="Proposed scope value" value={value} onChange={e => setValue(e.target.value)} disabled={added}
            style={{ flex: 1, minWidth: 0, padding: '6px', background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: '4px', color: theme.text, fontSize: '12px' }} />
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" onClick={handleAdd} disabled={loading || added}
            style={{ padding: '6px 12px', background: theme.accent, color: theme.bg, border: 'none', borderRadius: '4px', cursor: added ? 'default' : 'pointer', fontSize: '12px' }}>
            {added ? 'Added' : loading ? 'Adding…' : 'Add to scope'}
          </button>
          <button type="button" onClick={() => resolve('added')} disabled={!added}
            style={{ padding: '6px 12px', background: theme.accent, color: theme.bg, border: 'none', borderRadius: '4px', cursor: added ? 'pointer' : 'not-allowed', fontSize: '12px', opacity: added ? 1 : 0.5 }}>
            Continue
          </button>
          <button type="button" onClick={() => resolve('declined')} disabled={added}
            style={{ padding: '6px 12px', background: 'transparent', color: theme.muted, border: `1px solid ${theme.border}`, borderRadius: '4px', cursor: added ? 'not-allowed' : 'pointer', fontSize: '12px' }}>
            Decline
          </button>
        </div>
      </div>
    )
  }
```

- [ ] **Step 9: Add `resumeAfterScope` (DRY the resume helper) in `src/ipc.ts`**

Refactor `resumeAfterInputs` (lines 104-117) to share a private helper, and add `resumeAfterScope`:

```ts
function resumeWith(dispatch: Dispatch<Action>, chat: Chat, eng: Engagement, text: string, companyId?: string): void {
  const history = chat.messages
    .filter(m => m.kind === 'text' && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content as string }))
  dispatch({ t: 'setStreaming', chatId: chat.id, on: true })
  const runningIds = new Map<string, string>()
  window.nexra.agent.send(
    { chatId: chat.id, engagementType: eng.type, phaseLabel: phaseLabel(eng, chat.phaseId), text, history, companyId, engagementId: eng.id },
    applyEvent(dispatch, chat.id, runningIds),
  ).catch((err: unknown) => {
    dispatch({ t: 'appendError', chatId: chat.id, message: err instanceof Error ? err.message : 'Resume failed' })
    dispatch({ t: 'setStreaming', chatId: chat.id, on: false })
  })
}

export function resumeAfterInputs(dispatch: Dispatch<Action>, chat: Chat, eng: Engagement, companyId?: string): void {
  resumeWith(dispatch, chat, eng, 'The requested inputs have been provided. Continue.', companyId)
}

export function resumeAfterScope(dispatch: Dispatch<Action>, chat: Chat, eng: Engagement, companyId: string | undefined, outcome: 'added' | 'declined'): void {
  const text = outcome === 'added'
    ? 'The proposed scope item was added and is now in scope. Continue.'
    : 'The proposed scope item was declined; it remains out of scope. Do not target it. Continue.'
  resumeWith(dispatch, chat, eng, text, companyId)
}
```

(Keep the existing doc comment above `resumeAfterInputs`.)

- [ ] **Step 10: Thread `onScopeResolve` through `MessageList` and `ChatPane`**

In `src/components/MessageList.tsx`, extend the props (line 13) with `onScopeResolve?: (outcome: 'added' | 'declined') => void`, and pass it to `RequestCard` (line 89):

```tsx
              <RequestCard message={m} companyId={companyId} onFulfill={onResume ?? (() => {})} onScopeResolve={onScopeResolve} />
```

In `src/components/ChatPane.tsx`, import `resumeAfterScope` (line 10) and pass the prop on the `MessageList` (line 96):

```tsx
import { sendMessage, installTool, cancelStream, resumeAfterInputs, resumeAfterScope } from '../ipc'
```
```tsx
      <MessageList chat={chat} streaming={!!state.ui.streamingChats[chat.id]} onInstall={onInstall} companyId={company?.id}
        onResume={() => resumeAfterInputs(dispatch, chat, eng, company?.id)}
        onScopeResolve={(o) => resumeAfterScope(dispatch, chat, eng, company?.id, o)} />
```

- [ ] **Step 11: Run all touched suites + typecheck**

Run: `npx vitest run test/RequestCard.test.tsx test/ScopePanel.test.tsx test/ContextPanel.test.tsx test/MessageList.test.tsx`
Expected: PASS.
Run: `npm run typecheck` → Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add src/components/ScopePanel.tsx src/components/RequestCard.tsx src/components/MessageList.tsx src/components/ChatPane.tsx src/components/ContextPanel.tsx src/ipc.ts test/ScopePanel.test.tsx test/RequestCard.test.tsx test/ContextPanel.test.tsx
git commit -m "feat(scope): scope panel + AI proposal confirm card + resume wiring"
```

---

### Task 8: Remove the legacy per-engagement enforced scope

**Files (remove legacy `EngagementScope` path):**
- Modify: `electron/services/store.types.ts` (remove `EngagementScope`; remove `Engagement.enforcement`; drop `'scope'` from `Message.requestKind`)
- Modify: `electron/services/scope.ts` (remove `getScope`/`setScope`/`validate`/`Decision`/legacy `Target` fields usage — keep the expanded `Target`, `matchesScope`, project-scope fns)
- Modify: `electron/services/store.sqlite.ts` (remove `getScopeRow`/`setScopeRow`; drop the legacy `scope` table CREATE; add `DROP TABLE IF EXISTS scope`; drop `EngagementScope` import)
- Modify: `electron/main.ts` (remove `scope:get`/`scope:set`/`scope:set-and-validate` handlers + `getScope`/`setScope` import + `EngagementScope` import)
- Modify: `electron/preload.ts` (remove the `scope` namespace)
- Modify: `src/global.d.ts` (remove the `scope` interface + `EngagementScope` import)
- Modify: `electron/services/agent.types.ts` (remove the `scope_request` event)
- Modify: `src/ipc.ts` (remove the `scope_request` case)
- Modify: `src/state/reducer.ts` (remove `appendScopeRequest`, `fulfillScopeRequest` actions + cases + `EngagementScope` import)
- Modify: `src/components/RequestCard.tsx` (remove the `requestKind === 'scope'` variant + `EngagementScope` import)
- Delete/trim tests: `test/scope.test.ts` (delete — replaced by `scope.project.test.ts` + `store.sqlite.scope.test.ts`); remove the legacy `scope` tests in `test/RequestCard.test.tsx` (lines 70-90); remove the `appendScopeRequest` test in `test/reducer.test.ts`; remove the `scope_request` assertions in `test/ipc.test.ts`.

**Interfaces:** none produced; this task removes the dead path and leaves the suite green.

> Note: `ScopeRow` and `Engagement.scope` (the per-engagement *display* rows), the `engagements.scope` sqlite column, its seed data, and `ReviewTypeConfig.scope` are intentionally **left in place** — they are seed-only display data no longer read by any component, and removing the column would require an engagements-table migration for zero functional gain.

- [ ] **Step 1: Remove the event, IPC, and preload surfaces**

- `electron/services/agent.types.ts`: delete the `scope_request` line (`| { type: 'scope_request'; engagementId: string }`).
- `src/ipc.ts`: delete the `case 'scope_request':` block (the two lines dispatching `appendScopeRequest`).
- `electron/preload.ts`: delete the `scope:` namespace object (the `get`/`set`/`setAndValidate` block).
- `electron/main.ts`: delete the `scope:get`/`scope:set` handlers, the `scope:set-and-validate` handler, remove `getScope, setScope` from the `./services/scope` import, and remove `EngagementScope` from the `./services/store.types` import (keep `ScopeItemType`, `SecretField`, `Company`).

- [ ] **Step 2: Remove the reducer + RequestCard legacy scope**

- `src/state/reducer.ts`: delete the `appendScopeRequest` and `fulfillScopeRequest` entries from the `Action` union (lines 121, 123) and their `case` blocks (`appendScopeRequest` ~296-300, `fulfillScopeRequest` ~306-309). Remove `EngagementScope` from the import on line 4.
- `src/components/RequestCard.tsx`: delete the entire `if (message.requestKind === 'scope') { … }` block (lines 129-208) and remove `EngagementScope` from the import (line 2, keep `SecretField`, `InputRequestItem`, `ScopeItemType`).

- [ ] **Step 3: Remove the service + persistence + type surfaces**

- `electron/services/scope.ts`: delete `getScope`, `setScope`, `validate`, the `Decision` interface, and the `getScopeRow, setScopeRow` + `EngagementScope` imports (keep `randomUUID`, the store.sqlite scope-item imports, `getSetting`/`setSetting`, the expanded `Target`, `ScopeDecision`, and all project-scope fns + `matchesScope`/`ipInCidr`). Delete the stale header comment about `scope_request`.
- `electron/services/store.sqlite.ts`: delete `setScopeRow` and `getScopeRow` (lines 178-189); delete the legacy `scope` CREATE TABLE (lines 39-45) and in its place add `db.exec('DROP TABLE IF EXISTS scope')`; remove `EngagementScope` from the import on line 2.
- `electron/services/store.types.ts`: delete the `EngagementScope` interface (lines 57-61) and its doc comment; delete `enforcement?: EngagementScope` from `Engagement` (line 66); change `Message.requestKind` union to `'inputs' | 'scope_proposal'`.
- `src/global.d.ts`: delete the `scope` interface block (lines 40-44) and remove `EngagementScope` from the import on line 1.

- [ ] **Step 4: Remove/trim the legacy tests**

- Delete `test/scope.test.ts`: `git rm test/scope.test.ts`.
- `test/RequestCard.test.tsx`: delete the two legacy tests using `requestKind: 'scope'` / `scope.setAndValidate` (lines 70-90).
- `test/reducer.test.ts`: delete the `appendScopeRequest pushes a scope request message` test (lines 269-278). Keep the `appendScopeProposal` test added in Task 6.
- `test/ipc.test.ts`: in the "maps input_request / scope_request / skill events" test, delete the `sent!.onEvent({ type: 'scope_request', … })` line and the `appendScopeRequest` assertion (keep the `scope_proposal` lines added in Task 6). Rename the test title to drop `scope_request`.

- [ ] **Step 5: Run the FULL suite + build**

Run: `npm test`
Expected: PASS — no references to `EngagementScope`, `scope_request`, `getScope`/`setScope`, or `window.nexra.scope` remain.

Run: `npm run build`
Expected: `tsc` + Vite build succeed (proves preload/main/global.d.ts and the renderer all typecheck with the legacy surface removed).

- [ ] **Step 6: Verify no stragglers**

Run:
```bash
grep -rn "EngagementScope\|scope_request\|window.nexra.scope\|getScopeRow\|setScopeRow\|appendScopeRequest\|fulfillScopeRequest" electron src test
```
Expected: no output. If anything prints, fix it and re-run `npm test`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(scope): remove legacy per-engagement enforced scope"
```

---

## Self-Review (completed)

- **Spec coverage:** data model (T1), enforcement/`matchesScope` + gate rewire (T2, T4), both proposal triggers — explicit skill (T5) and blocked-target (T4), confirm card + add/authorize/resume (T6, T7), editable panel + notes shared per project (T7), IPC namespace (T3), persistence + schema migration/round-trip (T1, T6), removal of legacy enforced scope (T8). All spec sections map to a task.
- **`ScopeRow` display scope:** the spec says the new scope "replaces" the display rows; this plan satisfies that at the UI level (the scope tab renders `ScopePanel`, not `eng.scope`) and documents that the seed-only `ScopeRow` plumbing is deliberately retained to avoid an engagements-column migration — flagged for the implementer and reviewer as intentional, not an oversight.
- **Type consistency:** `getScope` dep is company-keyed and returns `ProjectScope` from T4 onward; `matchesScope`/`Target`/`ScopeDecision` names are consistent T2→T4; `proposeItem`/`scope_proposal`/`appendScopeProposal` names are consistent T4→T7; `resumeAfterScope(dispatch, chat, eng, companyId, outcome)` signature matches its ChatPane call.
- **Ordering/greenness:** each task ends with a green targeted run; the cross-cutting type removal is deferred to T8 so intermediate tasks compile against both the new and legacy surfaces.
