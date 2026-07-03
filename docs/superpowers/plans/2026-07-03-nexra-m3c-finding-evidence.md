# M3c — Finding Validation + Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the live agent an evidence-gated path to log findings so every surfaced finding carries a checkable artifact (captured tool output or a host+issue code block), never dropped for lacking evidence — unverified until the agent supplies proof, with verification computed below the LLM.

**Architecture:** Extend `Finding` with `id`/`rationale`/`evidence[]`/`verified` and a discriminated `Evidence` union (`tool_output` | `code_block` | `image`, last deferred). Persist findings + evidence to the existing sqlite DB. Replace `agent.live.ts`'s post-`done` skill parse with a bounded tool-result → model continuation loop that lets the agent call `log_finding`/`attach_evidence`, resolves a `tool_output` reference against a per-run stdout registry, and re-emits the finding as an upsert when it flips to verified.

**Tech Stack:** TypeScript, Electron (main + preload), React (renderer), Vercel AI SDK v6 (`ai`), `better-sqlite3`, Vitest (+ Testing Library for components).

## Global Constraints

- **No renderer component imports a service** — everything crosses the boundary via `window.nexra.*` (contextBridge in `electron/preload.ts`). Copied verbatim from CLAUDE.md.
- **Styling source of truth:** `nexra/design-reference/Nexra.dc.html`; match hex/px exactly, do not snap rgba alphas to the nearest token. Reuse `src/theme.ts` tokens already used by `ContextPanel`.
- **Icons are for actions/status, not decoration.** New finding UI is icon-light; use the existing colored severity dot + text badges, no new glyphs.
- **`verified` is computed in the main process, never set or overridable by the model.** (Spec §2.)
- **Findings are never dropped for lacking evidence** — they surface `verified:false`. (Spec §1.)
- **`Severity`** is exactly `'Critical' | 'High' | 'Medium' | 'Low'` (`store.types.ts:2`).
- **Verification gate:** `tsc --noEmit` + `npm run build` clean; all prior tests green (`npm test`). Run from `nexra/`.
- **Commit after every task** with a `feat(m3c)` / `test(m3c)` message.

## File Structure

New:
- `nexra/electron/services/agent.findings.ts` — pure helpers for the loop: the per-run stdout registry, `evidenceFromArgs` resolution, `computeVerified`, `normalizeSev`, `EXCERPT_MAX`. No I/O, unit-testable.
- `nexra/test/agent.findings.test.ts`, `nexra/test/store.sqlite.findings.test.ts` — new test files.

Modified:
- `nexra/electron/services/store.types.ts` — `Evidence` union + extended `Finding`.
- `nexra/electron/services/agent.types.ts` — extended `finding` event.
- `nexra/electron/services/store.sqlite.ts` — `findings` + `evidence` tables, `upsertFinding`, `listFindingsByChat`.
- `nexra/electron/services/agent.tools.ts` — `runSkill` accepts a caller-supplied invocation `id`.
- `nexra/electron/services/agent.live.ts` — the continuation loop.
- `nexra/electron/main.ts` — `findings:list` handler; thread `companyId`/`engagementId` into `runSend`.
- `nexra/electron/preload.ts` — `findings.list` bridge.
- `nexra/src/state/reducer.ts` — `upsertFinding` action.
- `nexra/src/ipc.ts` — `finding` event → `upsertFinding`; `rehydrateFindings`; `sendMessage` carries `companyId`.
- `nexra/src/App.tsx` — call `rehydrateFindings` after hydrate.
- `nexra/src/components/ChatPane.tsx` — pass `companyId` to `sendMessage`.
- `nexra/src/components/ContextPanel.tsx` — stable-id key, verified badge, expandable evidence.
- `nexra/electron/services/seed.ts` — update the 7 `Finding` literals to the new shape.
- Existing tests touching `Finding`/`finding`: `nexra/test/ipc.test.ts`, `nexra/test/reducer.test.ts` (only if they construct findings — verify during Task 1).

---

## Task 1: Extend Finding + Evidence types, reducer upsert, event mapping

**Files:**
- Modify: `nexra/electron/services/store.types.ts:25`
- Modify: `nexra/electron/services/agent.types.ts:16`
- Modify: `nexra/src/state/reducer.ts` (action union ~line 90; `appendFinding` case ~line 212; `clone` already spreads `findings`)
- Modify: `nexra/src/ipc.ts:44-45`
- Modify: `nexra/electron/services/seed.ts:71-102`
- Test: `nexra/test/reducer.test.ts`

**Interfaces:**
- Produces:
  - `Evidence = { kind:'tool_output'; toolCallId:string; excerpt:string } | { kind:'code_block'; host:string; detail:string } | { kind:'image' }`
  - `Finding = { id:string; title:string; sev:Severity; phase:string; time:string; rationale:string; evidence:Evidence[]; verified:boolean }`
  - reducer action `{ t:'upsertFinding'; chatId:string; finding:Finding }`
  - `finding` AgentEvent `{ type:'finding'; id:string; title:string; sev:Severity; phase:string; time:string; rationale:string; evidence:Evidence[]; verified:boolean }`
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test**

Add to `nexra/test/reducer.test.ts`:

```ts
import type { Finding } from '../electron/services/store.types'

const mkFinding = (over: Partial<Finding> = {}): Finding => ({
  id: 'f1', title: 'Public S3 bucket', sev: 'High', phase: 'Storage', time: 'just now',
  rationale: 'World-readable ACL', evidence: [], verified: false, ...over,
})

describe('upsertFinding', () => {
  const seededChat = () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const chatId = activeChat(s)!.id
    return { s, chatId }
  }
  it('inserts a new finding by id', () => {
    const { s, chatId } = seededChat()
    const before = activeChat(s)!.findings.length
    const s2 = reducer(s, { t: 'upsertFinding', chatId, finding: mkFinding() })
    const fs = chatByGlobalId(s2, chatId)!.findings
    expect(fs).toHaveLength(before + 1)
    expect(fs.find(f => f.id === 'f1')!.verified).toBe(false)
  })
  it('replaces an existing finding in place when the id matches', () => {
    const { s, chatId } = seededChat()
    const s2 = reducer(s, { t: 'upsertFinding', chatId, finding: mkFinding() })
    const countAfterInsert = chatByGlobalId(s2, chatId)!.findings.length
    const s3 = reducer(s2, { t: 'upsertFinding', chatId, finding: mkFinding({ verified: true, evidence: [{ kind: 'code_block', host: 's3://acme', detail: 'ACL public-read' }] }) })
    const fs = chatByGlobalId(s3, chatId)!.findings
    expect(fs).toHaveLength(countAfterInsert)          // no duplicate
    expect(fs.find(f => f.id === 'f1')!.verified).toBe(true)
    expect(fs.find(f => f.id === 'f1')!.evidence).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nexra && npx vitest run test/reducer.test.ts -t upsertFinding`
Expected: FAIL — `Object literal may only specify known properties` for `evidence`/`verified`, and no `upsertFinding` action handled.

- [ ] **Step 3: Extend the types**

In `store.types.ts`, replace line 25 (`export interface Finding { title: string; sev: Severity; phase: string; time: string }`) with:

```ts
// A checkable artifact behind a finding (M3c). `tool_output` references a
// captured skill run; `code_block` is the agent's structured statement of the
// affected host + issue; `image` is typed now, wired with the web/pentest
// verticals later.
export type Evidence =
  | { kind: 'tool_output'; toolCallId: string; excerpt: string }
  | { kind: 'code_block'; host: string; detail: string }
  | { kind: 'image' }

export interface Finding {
  id: string
  title: string
  sev: Severity
  phase: string
  time: string
  rationale: string        // why this severity — the model's reasoning
  evidence: Evidence[]     // ≥1 resolving artifact required to be verified
  verified: boolean        // computed in main; the model cannot set it
}
```

In `agent.types.ts`, add `Evidence` to the import on line 1 and replace line 16:

```ts
import type { Severity, ToolState, SecretField, Evidence } from './store.types'
```
```ts
  | { type: 'finding'; id: string; title: string; sev: Severity; phase: string; time: string; rationale: string; evidence: Evidence[]; verified: boolean }
```

- [ ] **Step 4: Add the reducer action + case**

In `reducer.ts` action union, replace the `appendFinding` line (~90):

```ts
  | { t: 'upsertFinding'; chatId: string; finding: Finding }
```

Replace the `appendFinding` case (~212-216) with:

```ts
    case 'upsertFinding': {
      const c = chatByGlobalId(s, a.chatId); if (!c) return state
      const idx = c.findings.findIndex(f => f.id === a.finding.id)
      if (idx >= 0) c.findings[idx] = a.finding
      else c.findings.push(a.finding)
      return s
    }
```

- [ ] **Step 5: Map the event in ipc.ts**

Replace `ipc.ts:44-45`:

```ts
      case 'finding':
        dispatch({ t: 'upsertFinding', chatId, finding: { id: e.id, title: e.title, sev: e.sev, phase: e.phase, time: e.time, rationale: e.rationale, evidence: e.evidence, verified: e.verified } })
        break
```

- [ ] **Step 6: Update seed findings to the new shape**

In `seed.ts`, add a helper above the seed data (near the top, after imports) — reuse the existing `Finding` import or add `import type { Finding } from './store.types'`:

```ts
let _sfid = 0
// Seed findings are demo/first-run data; give them a verified code_block so the
// Findings panel demonstrates the M3c evidence UI.
const seedFinding = (title: string, sev: Finding['sev'], phase: string, time: string): Finding => ({
  id: 'f-seed-' + (++_sfid), title, sev, phase, time,
  rationale: `${sev} severity — see evidence.`,
  evidence: [{ kind: 'code_block', host: 'seed', detail: title }],
  verified: true,
})
```

Replace each of the 7 finding object literals (`seed.ts:71-74`, `91-92`, `102`) — e.g. line 71 `{ title: 'ci-deployer role grants iam:* on *', sev: 'Critical', phase: 'IAM', time: '2m ago' }` becomes `seedFinding('ci-deployer role grants iam:* on *', 'Critical', 'IAM', '2m ago')`. Do the same for all seven, preserving each title/sev/phase/time.

- [ ] **Step 7: Fix any other Finding constructors**

Run: `cd nexra && grep -rn "sev:" test/ipc.test.ts test/reducer.test.ts src/ electron/ | grep -iv "sevColor\|Severity"`
For any remaining literal that builds a `Finding` or a `finding` event without the new fields (e.g. an `ipc.test.ts` finding-event fixture), add `id`, `rationale`, `evidence: []`, `verified: false`. If `ipc.test.ts` asserts a `finding` event dispatch, update its expected dispatch to `{ t: 'upsertFinding', ... }` with the new finding shape.

- [ ] **Step 8: Run tests + typecheck**

Run: `cd nexra && npx vitest run test/reducer.test.ts test/ipc.test.ts && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 9: Commit**

```bash
git add nexra/electron/services/store.types.ts nexra/electron/services/agent.types.ts nexra/src/state/reducer.ts nexra/src/ipc.ts nexra/electron/services/seed.ts nexra/test/
git commit -m "feat(m3c): Finding+Evidence types, upsertFinding reducer, finding event upgrade"
```

---

## Task 2: Persist findings + evidence to sqlite

**Files:**
- Modify: `nexra/electron/services/store.sqlite.ts` (schema in `initSettingsDb`; new CRUD at end)
- Test: `nexra/test/store.sqlite.findings.test.ts` (new)

**Interfaces:**
- Consumes: `Finding`, `Evidence`, `Severity` from `store.types`.
- Produces:
  - `upsertFinding(chatId: string, f: Finding): void`
  - `listFindingsByChat(chatId: string): Finding[]`

- [ ] **Step 1: Write the failing test**

Create `nexra/test/store.sqlite.findings.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initSettingsDb, setSetting, getSetting, upsertFinding, listFindingsByChat } from '../electron/services/store.sqlite'
import type { Finding } from '../electron/services/store.types'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-fnd-')); initSettingsDb(join(dir, 'nexra.db')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const f = (over: Partial<Finding> = {}): Finding => ({
  id: 'f1', title: 'Public S3 bucket', sev: 'High', phase: 'Storage', time: 'just now',
  rationale: 'World-readable ACL', verified: true,
  evidence: [{ kind: 'tool_output', toolCallId: 'tc7', excerpt: 'BucketPublicAccess: true' }],
  ...over,
})

describe('findings store', () => {
  it('returns [] for a chat with no findings', () => {
    expect(listFindingsByChat('chatX')).toEqual([])
  })
  it('round-trips a finding with its evidence', () => {
    upsertFinding('chatA', f())
    const got = listFindingsByChat('chatA')
    expect(got).toHaveLength(1)
    expect(got[0]).toEqual(f())
  })
  it('upsert replaces the row and its evidence in place (no dup, no stale evidence)', () => {
    upsertFinding('chatA', f({ verified: false, evidence: [] }))
    upsertFinding('chatA', f({ verified: true, evidence: [{ kind: 'code_block', host: 's3://acme', detail: 'ACL public-read' }] }))
    const got = listFindingsByChat('chatA')
    expect(got).toHaveLength(1)
    expect(got[0].verified).toBe(true)
    expect(got[0].evidence).toEqual([{ kind: 'code_block', host: 's3://acme', detail: 'ACL public-read' }])
  })
  it('scopes findings by chat', () => {
    upsertFinding('chatA', f({ id: 'a1' }))
    upsertFinding('chatB', f({ id: 'b1' }))
    expect(listFindingsByChat('chatA').map(x => x.id)).toEqual(['a1'])
  })
  it('survives a reopen and does not disturb settings/secrets/scope tables', () => {
    setSetting('provider', 'anthropic')
    upsertFinding('chatA', f())
    initSettingsDb(join(dir, 'nexra.db'))               // reopen existing db
    expect(getSetting('provider')).toBe('anthropic')     // migration additive
    expect(listFindingsByChat('chatA')).toEqual([f()])   // evidence excerpt intact
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nexra && npx vitest run test/store.sqlite.findings.test.ts`
Expected: FAIL — `upsertFinding`/`listFindingsByChat` are not exported.

- [ ] **Step 3: Add the tables**

In `store.sqlite.ts` `initSettingsDb`, after the `scope` table block (line 42), add:

```ts
  // Findings + their evidence artifacts (M3c). Pulled forward from M4; chat_id
  // is a plain column now (companies/engagements/chats live in the mock
  // snapshot, not sqlite yet). M4 adds those parent tables + FKs — an additive
  // migration, not a rewrite.
  db.exec(`CREATE TABLE IF NOT EXISTS findings (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    title TEXT NOT NULL,
    sev TEXT NOT NULL,
    phase TEXT NOT NULL,
    time TEXT NOT NULL,
    rationale TEXT NOT NULL,
    verified INTEGER NOT NULL
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    finding_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    tool_call_id TEXT,
    excerpt TEXT,
    host TEXT,
    detail TEXT
  )`)
```

- [ ] **Step 4: Add the CRUD**

Add to the import on line 2: `Finding, Evidence`. Append at the end of `store.sqlite.ts`:

```ts
// ── findings + evidence (M3c) ───────────────────────────────────────────────
interface FindingRow { id: string; chat_id: string; title: string; sev: string; phase: string; time: string; rationale: string; verified: number }
interface EvidenceRow { kind: string; tool_call_id: string | null; excerpt: string | null; host: string | null; detail: string | null }

function rowToEvidence(r: EvidenceRow): Evidence {
  if (r.kind === 'tool_output') return { kind: 'tool_output', toolCallId: r.tool_call_id ?? '', excerpt: r.excerpt ?? '' }
  if (r.kind === 'code_block') return { kind: 'code_block', host: r.host ?? '', detail: r.detail ?? '' }
  return { kind: 'image' }
}

// Insert-or-replace a finding and its evidence. Evidence rows are fully
// replaced so an upsert that changes evidence never leaves stale rows.
export function upsertFinding(chatId: string, f: Finding): void {
  const d = requireDb()
  d.prepare(
    `INSERT INTO findings (id, chat_id, title, sev, phase, time, rationale, verified)
     VALUES (@id, @chat_id, @title, @sev, @phase, @time, @rationale, @verified)
     ON CONFLICT(id) DO UPDATE SET
       chat_id=excluded.chat_id, title=excluded.title, sev=excluded.sev,
       phase=excluded.phase, time=excluded.time, rationale=excluded.rationale,
       verified=excluded.verified`,
  ).run({ id: f.id, chat_id: chatId, title: f.title, sev: f.sev, phase: f.phase, time: f.time, rationale: f.rationale, verified: f.verified ? 1 : 0 })
  d.prepare('DELETE FROM evidence WHERE finding_id = ?').run(f.id)
  const ins = d.prepare('INSERT INTO evidence (finding_id, kind, tool_call_id, excerpt, host, detail) VALUES (?, ?, ?, ?, ?, ?)')
  for (const ev of f.evidence) {
    if (ev.kind === 'tool_output') ins.run(f.id, ev.kind, ev.toolCallId, ev.excerpt, null, null)
    else if (ev.kind === 'code_block') ins.run(f.id, ev.kind, null, null, ev.host, ev.detail)
    else ins.run(f.id, ev.kind, null, null, null, null)
  }
}

export function listFindingsByChat(chatId: string): Finding[] {
  const d = requireDb()
  const rows = d.prepare('SELECT * FROM findings WHERE chat_id = ? ORDER BY rowid').all(chatId) as FindingRow[]
  const evStmt = d.prepare('SELECT kind, tool_call_id, excerpt, host, detail FROM evidence WHERE finding_id = ? ORDER BY id')
  return rows.map(r => ({
    id: r.id, title: r.title, sev: r.sev as Finding['sev'], phase: r.phase, time: r.time,
    rationale: r.rationale, verified: !!r.verified,
    evidence: (evStmt.all(r.id) as EvidenceRow[]).map(rowToEvidence),
  }))
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd nexra && npx vitest run test/store.sqlite.findings.test.ts test/store.sqlite.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add nexra/electron/services/store.sqlite.ts nexra/test/store.sqlite.findings.test.ts
git commit -m "feat(m3c): sqlite findings+evidence tables with upsert/list"
```

---

## Task 3: findings IPC + boot rehydration

**Files:**
- Modify: `nexra/electron/main.ts` (add handler near `scope:get`, ~line 103)
- Modify: `nexra/electron/preload.ts` (add `findings` bridge, ~after `scope`)
- Modify: `nexra/src/ipc.ts` (add `rehydrateFindings`; extend the `window.nexra` type usage)
- Modify: `nexra/src/App.tsx:14-18`
- Test: `nexra/test/ipc.test.ts` (add a `rehydrateFindings` block)

**Interfaces:**
- Consumes: `listFindingsByChat` (Task 2), `upsertFinding` reducer action (Task 1).
- Produces:
  - preload `window.nexra.findings.list(chatId: string): Promise<Finding[]>`
  - `rehydrateFindings(dispatch: Dispatch<Action>, data: AppState['data']): void`

- [ ] **Step 1: Write the failing test**

Add to `nexra/test/ipc.test.ts` (it already mocks `window.nexra`):

```ts
import { rehydrateFindings } from '../src/ipc'
import type { Finding } from '../electron/services/store.types'

describe('rehydrateFindings', () => {
  it('lists findings per chat and dispatches an upsert for each', async () => {
    const persisted: Record<string, Finding[]> = {
      chA: [{ id: 'f1', title: 'x', sev: 'High', phase: 'IAM', time: 'now', rationale: 'r', evidence: [], verified: false }],
      chB: [],
    }
    ;(globalThis as any).window.nexra.findings = { list: (id: string) => Promise.resolve(persisted[id] ?? []) }
    const data = { companies: [{ id: 'c1', name: 'Acme', updated: '', engagements: [
      { id: 'e1', type: 'aws', name: 'E', status: 'In Progress', updated: '', linear: true, phases: [], scope: [], chats: [
        { id: 'chA', name: 'A', phaseId: '', color: '#000', messages: [], findings: [], tools: [] },
        { id: 'chB', name: 'B', phaseId: '', color: '#000', messages: [], findings: [], tools: [] },
      ] },
    ] }], types: {} } as any
    const dispatched: any[] = []
    rehydrateFindings((a: any) => dispatched.push(a), data)
    await new Promise(r => setTimeout(r, 0))
    expect(dispatched).toContainEqual({ t: 'upsertFinding', chatId: 'chA', finding: persisted.chA[0] })
    expect(dispatched.filter(a => a.chatId === 'chB')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nexra && npx vitest run test/ipc.test.ts -t rehydrateFindings`
Expected: FAIL — `rehydrateFindings` is not exported.

- [ ] **Step 3: Add the main handler**

In `main.ts`, add near the other read handlers (after the `scope:get` handler, ~line 103) — import `listFindingsByChat` from `./services/store.sqlite` at the top alongside the existing sqlite imports:

```ts
  ipcMain.handle('findings:list', (_ev, chatId: string) => listFindingsByChat(chatId))
```

- [ ] **Step 4: Add the preload bridge**

In `preload.ts`, add after the `scope` block:

```ts
  findings: {
    list: (chatId: string) => ipcRenderer.invoke('findings:list', chatId),
  },
```

- [ ] **Step 5: Add rehydrateFindings**

In `ipc.ts`, add `Finding` to the `store.types` import and append:

```ts
import type { AppState } from './state/selectors'

// After boot, pull any persisted findings for every chat into reducer state.
// Findings key on chat_id; seeded chats have stable ids, so their findings
// rehydrate across restart. (Full coverage arrives when M4 persists chats.)
export function rehydrateFindings(dispatch: Dispatch<Action>, data: AppState['data']): void {
  data.companies.forEach(c => c.engagements.forEach(e => e.chats.forEach(ch => {
    window.nexra.findings.list(ch.id).then((fs: Finding[]) =>
      fs.forEach(f => dispatch({ t: 'upsertFinding', chatId: ch.id, finding: f })))
  })))
}
```

If `window.nexra`'s type is declared in a `.d.ts`, add `findings: { list(chatId: string): Promise<Finding[]> }` to it so `tsc` passes; otherwise the `any`-typed bridge needs no change.

- [ ] **Step 6: Call it on boot**

In `App.tsx`, update the boot effect (lines 14-18) — import `getSnapshot, rehydrateFindings` from `./ipc`:

```ts
    getSnapshot().then(data => {
      const seeded: AppState = { data, ui: initialUI }
      dispatch({ t: 'hydrate', data })
      dispatch({ t: 'seedActiveMap', map: initialActiveMap(seeded) })
      rehydrateFindings(dispatch, data)
    })
```

- [ ] **Step 7: Run tests + typecheck + build**

Run: `cd nexra && npx vitest run test/ipc.test.ts && npx tsc --noEmit && npm run build`
Expected: PASS; build clean.

- [ ] **Step 8: Commit**

```bash
git add nexra/electron/main.ts nexra/electron/preload.ts nexra/src/ipc.ts nexra/src/App.tsx nexra/test/ipc.test.ts
git commit -m "feat(m3c): findings:list IPC + boot rehydration into reducer state"
```

---

## Task 4: ContextPanel — stable key, verified badge, expandable evidence

**Files:**
- Modify: `nexra/src/components/ContextPanel.tsx:39-41,110-134`
- Test: `nexra/test/ContextPanel.test.tsx` (new)

**Interfaces:**
- Consumes: `Finding`/`Evidence` shape (Task 1), `sevColor` (`selectors.ts:40`), `theme`.
- Produces: no new exports (component behavior only).

- [ ] **Step 1: Write the failing test**

Create `nexra/test/ContextPanel.test.tsx` (follow `test/MessageList.test.tsx` / `test/setup.ts` conventions):

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { ContextPanel } from '../src/components/ContextPanel'
import { reducer, initialUI } from '../src/state/reducer'
import { buildSnapshot } from '../electron/services/store.mock'
import { activeChat, activeEngagement } from '../src/state/selectors'
import type { Finding } from '../electron/services/store.types'

function mountWithFindings(findings: Finding[]) {
  let s = reducer({ data: buildSnapshot(), ui: initialUI }, { t: 'openCompany', id: 'c1' })
  const chatId = activeChat(s)!.id
  // clear seed findings, then add ours
  activeChat(s)!.findings.length = 0
  for (const f of findings) s = reducer(s, { t: 'upsertFinding', chatId, finding: f })
  const dispatch = () => {}
  return render(<ContextPanel state={s} dispatch={dispatch as any} />)
}

const verified: Finding = { id: 'v1', title: 'Public S3 bucket', sev: 'High', phase: 'Storage', time: 'now', rationale: 'World-readable ACL', verified: true, evidence: [{ kind: 'tool_output', toolCallId: 'tc7', excerpt: 'BucketPublicAccess: true' }] }
const unverified: Finding = { id: 'u1', title: 'Root MFA missing', sev: 'Critical', phase: 'IAM', time: 'now', rationale: 'No hardware MFA', verified: false, evidence: [] }

describe('ContextPanel findings', () => {
  it('shows a verified badge and reveals the tool-output excerpt on expand', () => {
    mountWithFindings([verified])
    fireEvent.click(screen.getByText('findings'))
    expect(screen.getByText(/verified/i)).toBeTruthy()
    fireEvent.click(screen.getByText('Public S3 bucket'))
    expect(screen.getByText(/BucketPublicAccess: true/)).toBeTruthy()
    expect(screen.getByText(/World-readable ACL/)).toBeTruthy()
  })
  it('marks a finding without evidence as unverified', () => {
    mountWithFindings([unverified])
    fireEvent.click(screen.getByText('findings'))
    expect(screen.getByText(/unverified/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nexra && npx vitest run test/ContextPanel.test.tsx`
Expected: FAIL — no "verified"/"unverified" text, excerpt not rendered.

- [ ] **Step 3: Track expansion state**

In `ContextPanel.tsx`, add near the other `useState` (after line 17):

```tsx
  const [expandedFinding, setExpandedFinding] = useState<string | null>(null)
```

Line 39 already maps findings with a `color`; keep it. It is `f.color` per finding.

- [ ] **Step 4: Rewrite the findings list render**

Replace the findings map block (`ContextPanel.tsx:120-131`, the `findings.map((f, i) => ( ... ))`) with a stable-key, badge + expandable version:

```tsx
              {findings.map(f => {
                const open = expandedFinding === f.id
                return (
                  <div key={f.id} style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 9, overflow: 'hidden' }}>
                    <div onClick={() => setExpandedFinding(open ? null : f.id)} style={{ display: 'flex', gap: 10, padding: '10px 12px', cursor: 'pointer' }}>
                      <span style={{ flex: 'none', width: 8, height: 8, borderRadius: 2, background: f.color, marginTop: 5 }}></span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, lineHeight: 1.45, color: '#dfe2e6', marginBottom: 5 }}>{f.title}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: f.color }}>{f.sev}</span>
                          <span style={{ fontSize: 10.5, color: theme.dim2 }}>{f.phase} · {f.time}</span>
                          <span style={{ marginLeft: 'auto', fontSize: 9.5, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: f.verified ? '#46c47f' : '#e6a23c' }}>{f.verified ? 'Verified' : 'Unverified'}</span>
                        </div>
                      </div>
                    </div>
                    {open && (
                      <div style={{ padding: '0 12px 11px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                        {f.rationale && <div style={{ fontSize: 11.5, color: theme.dim, margin: '9px 0' }}>{f.rationale}</div>}
                        {f.evidence.map((ev, ei) => (
                          <div key={ei} style={{ marginTop: 8 }}>
                            {ev.kind === 'tool_output' && (
                              <pre style={{ margin: 0, padding: '8px 10px', background: theme.bg2, border: `1px solid ${theme.border}`, borderRadius: 7, fontFamily: theme.mono, fontSize: 11, color: theme.textDim, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 180, overflowY: 'auto' }}>{ev.excerpt}</pre>
                            )}
                            {ev.kind === 'code_block' && (
                              <div style={{ padding: '8px 10px', background: theme.bg2, border: `1px solid ${theme.border}`, borderRadius: 7 }}>
                                <div style={{ fontFamily: theme.mono, fontSize: 11, color: theme.textDim }}>{ev.host}</div>
                                <div style={{ fontSize: 11.5, color: theme.dim, marginTop: 3 }}>{ev.detail}</div>
                              </div>
                            )}
                          </div>
                        ))}
                        {f.evidence.length === 0 && <div style={{ fontSize: 11.5, color: '#e6a23c', marginTop: 9 }}>Awaiting evidence.</div>}
                      </div>
                    )}
                  </div>
                )
              })}
```

Keep the surrounding `<div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 24 }}>` wrapper (line 119) and the empty-state block (line 116-118) unchanged.

- [ ] **Step 5: Run tests + typecheck**

Run: `cd nexra && npx vitest run test/ContextPanel.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add nexra/src/components/ContextPanel.tsx nexra/test/ContextPanel.test.tsx
git commit -m "feat(m3c): ContextPanel verified badge + expandable evidence, stable id key"
```

---

## Task 5: agent.findings.ts — run registry, evidence resolution, verification

**Files:**
- Create: `nexra/electron/services/agent.findings.ts`
- Test: `nexra/test/agent.findings.test.ts` (new)

**Interfaces:**
- Consumes: `Evidence`, `Severity` from `store.types`; `AgentEvent` from `agent.types`.
- Produces:
  - `EXCERPT_MAX: number` (2000)
  - `createRunRegistry(): { record(e: AgentEvent): void; get(id: string): string | undefined }`
  - `evidenceFromArgs(args: Record<string,string>, registry: { get(id: string): string | undefined }): Evidence | null`
  - `computeVerified(evidence: Evidence[]): boolean`
  - `normalizeSev(s: string | undefined): Severity`

- [ ] **Step 1: Write the failing test**

Create `nexra/test/agent.findings.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createRunRegistry, evidenceFromArgs, computeVerified, normalizeSev, EXCERPT_MAX } from '../electron/services/agent.findings'
import type { AgentEvent } from '../electron/services/agent.types'

describe('createRunRegistry', () => {
  it('accumulates skill stdout chunks by invocation id', () => {
    const r = createRunRegistry()
    const evs: AgentEvent[] = [
      { type: 'skill', id: 'tc1', skill: 'run_prowler', state: 'running' },
      { type: 'skill', id: 'tc1', skill: 'run_prowler', state: 'output', chunk: 'Bucket ' },
      { type: 'skill', id: 'tc1', skill: 'run_prowler', state: 'output', chunk: 'public: true' },
      { type: 'skill', id: 'tc1', skill: 'run_prowler', state: 'success', exitCode: 0 },
    ]
    evs.forEach(e => r.record(e))
    expect(r.get('tc1')).toBe('Bucket public: true')
    expect(r.get('missing')).toBeUndefined()
  })
})

describe('evidenceFromArgs', () => {
  const reg = { get: (id: string) => (id === 'tc1' ? 'RAW OUTPUT' : undefined) }
  it('resolves a tool_output reference to a snapshotted excerpt', () => {
    expect(evidenceFromArgs({ tool_output: 'tc1' }, reg)).toEqual({ kind: 'tool_output', toolCallId: 'tc1', excerpt: 'RAW OUTPUT' })
  })
  it('returns null for an unresolvable tool_output reference', () => {
    expect(evidenceFromArgs({ tool_output: 'nope' }, reg)).toBeNull()
  })
  it('bounds the excerpt to EXCERPT_MAX', () => {
    const big = { get: () => 'x'.repeat(EXCERPT_MAX + 500) }
    const ev = evidenceFromArgs({ tool_output: 'tc1' }, big) as { excerpt: string }
    expect(ev.excerpt.length).toBe(EXCERPT_MAX)
  })
  it('builds a code_block from host + detail', () => {
    expect(evidenceFromArgs({ host: 's3://acme', detail: 'ACL public-read' }, reg)).toEqual({ kind: 'code_block', host: 's3://acme', detail: 'ACL public-read' })
  })
  it('returns null when no usable evidence args are present', () => {
    expect(evidenceFromArgs({ host: 's3://acme' }, reg)).toBeNull()   // detail missing
    expect(evidenceFromArgs({}, reg)).toBeNull()
  })
})

describe('computeVerified', () => {
  it('is true iff there is at least one evidence artifact', () => {
    expect(computeVerified([])).toBe(false)
    expect(computeVerified([{ kind: 'code_block', host: 'h', detail: 'd' }])).toBe(true)
  })
})

describe('normalizeSev', () => {
  it('maps case-insensitively and defaults to Medium', () => {
    expect(normalizeSev('high')).toBe('High')
    expect(normalizeSev('CRITICAL')).toBe('Critical')
    expect(normalizeSev(undefined)).toBe('Medium')
    expect(normalizeSev('bogus')).toBe('Medium')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nexra && npx vitest run test/agent.findings.test.ts`
Expected: FAIL — module `agent.findings` not found.

- [ ] **Step 3: Implement the module**

Create `nexra/electron/services/agent.findings.ts`:

```ts
import type { Evidence, Severity } from './store.types'
import type { AgentEvent } from './agent.types'

// Cap on a snapshotted tool-output excerpt so evidence stays reviewable and the
// DB stays small. (Spec §11.)
export const EXCERPT_MAX = 2000

// Accumulates skill stdout per invocation id so a later evidence reference
// (tool_output=<id>) resolves to real captured output. Fed every AgentEvent the
// loop emits; only skill `output` chunks are retained.
export function createRunRegistry() {
  const out = new Map<string, string>()
  return {
    record(e: AgentEvent): void {
      if (e.type === 'skill' && e.state === 'output' && e.chunk) out.set(e.id, (out.get(e.id) ?? '') + e.chunk)
    },
    get(id: string): string | undefined { return out.get(id) },
  }
}

// Build an Evidence artifact from parsed SKILL_CALL args. A tool_output ref must
// resolve against the registry (else null → finding stays unverified); a
// code_block needs both host and detail.
export function evidenceFromArgs(args: Record<string, string>, registry: { get(id: string): string | undefined }): Evidence | null {
  if (args.tool_output) {
    const captured = registry.get(args.tool_output)
    if (captured == null) return null
    return { kind: 'tool_output', toolCallId: args.tool_output, excerpt: captured.slice(0, EXCERPT_MAX) }
  }
  if (args.host && args.detail) return { kind: 'code_block', host: args.host, detail: args.detail }
  return null
}

export function computeVerified(evidence: Evidence[]): boolean {
  return evidence.length > 0
}

const SEVS: Severity[] = ['Critical', 'High', 'Medium', 'Low']
export function normalizeSev(s: string | undefined): Severity {
  return SEVS.find(v => v.toLowerCase() === (s ?? '').toLowerCase()) ?? 'Medium'
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd nexra && npx vitest run test/agent.findings.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add nexra/electron/services/agent.findings.ts nexra/test/agent.findings.test.ts
git commit -m "feat(m3c): agent.findings — run registry, evidence resolution, verification"
```

---

## Task 6: agent.live.ts — continuation loop with log_finding/attach_evidence

**Files:**
- Modify: `nexra/electron/services/agent.tools.ts:60-66` (accept a caller-supplied `id`)
- Modify: `nexra/electron/services/agent.live.ts` (replace post-`done` parse with the loop)
- Test: `nexra/test/agent.live.findings.test.ts` (new)

**Interfaces:**
- Consumes: `createRunRegistry`, `evidenceFromArgs`, `computeVerified`, `normalizeSev` (Task 5); `upsertFinding` (Task 2, mocked in test); `runSkill`, `AWS_SKILLS` (existing).
- Produces: `runSend` unchanged in signature (`(req, cfg, emit, signal, companyId?, engagementId?)`) but now loops; `runSkill(inv, def, emit, deps, id?)` gains an optional final `id` param.

- [ ] **Step 1: Write the failing test**

Create `nexra/test/agent.live.findings.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const streamText = vi.fn()
vi.mock('ai', () => ({ streamText: (o: any) => streamText(o) }))
vi.mock('../electron/services/providers', () => ({ resolveModel: () => ({ tag: 'fake-model' }) }))
const upsertFinding = vi.fn()
vi.mock('../electron/services/store.sqlite', () => ({ upsertFinding: (...a: any[]) => upsertFinding(...a) }))

import { runSend } from '../electron/services/agent.live'
import type { AgentEvent, AgentSendRequest } from '../electron/services/agent.types'
import type { ProviderConfig } from '../electron/services/providers'

const req: AgentSendRequest = { chatId: 'chat-1', engagementType: 'aws', phaseLabel: 'Storage', primaryTool: 'prowler', text: 'audit s3', history: [] }
const cfg: ProviderConfig = { provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'sk-1' }
const fakeStream = (parts: string[]) => ({ textStream: (async function* () { for (const p of parts) yield p })(), usage: Promise.resolve({ totalTokens: 1 }) })

beforeEach(() => { streamText.mockReset(); upsertFinding.mockReset() })

describe('runSend finding loop', () => {
  it('logs an unverified finding, then verifies it after the agent attaches evidence', async () => {
    streamText
      .mockReturnValueOnce(fakeStream(['SKILL_CALL[log_finding|title=Public bucket|sev=High|phase=Storage|rationale=world-readable]']))
      .mockReturnValueOnce(fakeStream(['SKILL_CALL[attach_evidence|host=s3://acme|detail=ACL public-read]']))
      .mockReturnValueOnce(fakeStream(['All set.']))
    const events: AgentEvent[] = []
    await runSend(req, cfg, e => events.push(e), new AbortController().signal)

    const findings = events.filter(e => e.type === 'finding') as Extract<AgentEvent, { type: 'finding' }>[]
    expect(findings).toHaveLength(2)
    expect(findings[0].verified).toBe(false)
    expect(findings[1].verified).toBe(true)
    expect(findings[0].id).toBe(findings[1].id)                 // same finding, upserted
    expect(findings[1].evidence).toEqual([{ kind: 'code_block', host: 's3://acme', detail: 'ACL public-read' }])
    expect(findings[1].sev).toBe('High')
    // persisted both times, last write verified
    expect(upsertFinding).toHaveBeenCalledWith('chat-1', expect.objectContaining({ verified: true }))
    expect(events[events.length - 1]).toEqual({ type: 'done' })
  })

  it('still emits text_delta then done for a plain reply with no skill calls (loop is transparent)', async () => {
    streamText.mockReturnValueOnce(fakeStream(['Hel', 'lo']))
    const events: AgentEvent[] = []
    await runSend(req, cfg, e => events.push(e), new AbortController().signal)
    expect(events).toEqual([{ type: 'text_delta', delta: 'Hel' }, { type: 'text_delta', delta: 'lo' }, { type: 'done' }])
  })

  it('stops at STEP_CAP even if the model keeps emitting skill calls', async () => {
    // Fresh stream per call — an async generator is single-use, so mockReturnValue
    // would exhaust after turn 1 and the loop would break early.
    streamText.mockImplementation(() => fakeStream(['SKILL_CALL[log_finding|title=loop|sev=Low]']))
    const events: AgentEvent[] = []
    await runSend(req, cfg, e => events.push(e), new AbortController().signal)
    expect(streamText.mock.calls.length).toBeLessThanOrEqual(6)   // STEP_CAP
    expect(events[events.length - 1]).toEqual({ type: 'done' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nexra && npx vitest run test/agent.live.findings.test.ts`
Expected: FAIL — only one stream consumed, no `finding` events, no loop.

- [ ] **Step 3: Let runSkill accept a caller-supplied id**

In `agent.tools.ts`, change the `runSkill` signature (line 60) and the id line (67) so the loop can share one id between the emitted events and the feedback string:

```ts
export function runSkill(
  inv: SkillInvocation,
  def: SkillDef,
  emit: (e: AgentEvent) => void,
  deps: RunDeps,
  id: string = randomUUID(),
): Promise<SkillResult> {
```

Delete the old `const id = randomUUID()` line inside the body. (Existing 4-arg callers are unaffected.)

- [ ] **Step 4: Rewrite runSend as a bounded loop**

Replace the body of `agent.live.ts` from the imports down through `runSend`. Keep `parseSkillCalls` and `systemPrompt` (extend the skills text). New file content:

```ts
import { streamText } from 'ai'
import { randomUUID } from 'node:crypto'
import type { AgentEvent, AgentSendRequest } from './agent.types'
import type { Finding } from './store.types'
import { resolveModel, type ProviderConfig } from './providers'
import { runSkill, AWS_SKILLS, type RunDeps, type SkillInvocation } from './agent.tools'
import { getScope } from './scope'
import { hasFilledSecret, injectEnv } from './secrets.vault'
import { upsertFinding } from './store.sqlite'
import { createRunRegistry, evidenceFromArgs, computeVerified, normalizeSev } from './agent.findings'

const STEP_CAP = 6

interface DetectedSkill { name: string; args: Record<string, string> }

function parseSkillCalls(text: string): DetectedSkill[] {
  const regex = /SKILL_CALL\[([a-z_]+)\|([^\]]+)\]/g
  const skills: DetectedSkill[] = []
  let match
  while ((match = regex.exec(text)) !== null) {
    const name = match[1]
    const args: Record<string, string> = {}
    for (const pair of match[2].split('|')) {
      const eq = pair.indexOf('=')
      if (eq > 0) args[pair.slice(0, eq)] = pair.slice(eq + 1)
    }
    skills.push({ name, args })
  }
  return skills
}

function systemPrompt(engagementType: string, phaseLabel: string): string {
  const phase = phaseLabel ? ` Its current phase is: ${phaseLabel}.` : ''
  const skills = `
Available skills — invoke by writing SKILL_CALL[name|arg=value|...]:
- run_prowler|account=ID|region=REGION: Enumerate via Prowler.
- run_scoutsuite|account=ID: Enumerate via ScoutSuite.
- run_pmapper|account=ID: Enumerate via PMapper.
- log_finding|title=TEXT|sev=Critical|High|Medium|Low|phase=TEXT|rationale=TEXT: Log a finding. Attach evidence in the SAME call with tool_output=SKILL_ID (a prior skill run) or host=HOST|detail=ISSUE.
- attach_evidence|finding=FINDING_ID|tool_output=SKILL_ID  OR  |host=HOST|detail=ISSUE: Attach evidence to a finding you logged. A finding is UNVERIFIED until evidence is attached; always verify your findings.`
  return (
    `You are Nexra, an AI assistant embedded in a security consultant's console, ` +
    `helping with a ${engagementType} engagement.${phase} ` +
    `Be precise and practical. Every finding you log MUST be backed by evidence. ` +
    skills
  )
}

// Streams a live model response and drives a bounded tool-result -> model
// continuation loop (M3c): the model may run skills and log findings; each
// skill/finding result is fed back so the model can react — e.g. attach
// evidence to a finding it just logged. Verification is computed here, never by
// the model. Emits text_delta / skill / finding events, then a single done. An
// abort finalizes with done; a stream error emits error and no done.
export async function runSend(
  req: AgentSendRequest,
  cfg: ProviderConfig,
  emit: (e: AgentEvent) => void,
  signal: AbortSignal,
  companyId?: string,
  engagementId?: string,
): Promise<void> {
  let model
  try { model = resolveModel(cfg) } catch (err) { emit({ type: 'error', message: (err as Error).message }); return }

  const firstUser = req.history.findIndex(m => m.role === 'user')
  const prior = firstUser === -1 ? [] : req.history.slice(firstUser)
  const messages: { role: 'user' | 'assistant'; content: string }[] = [...prior, { role: 'user', content: req.text }]

  const registry = createRunRegistry()
  const recordingEmit = (e: AgentEvent) => { registry.record(e); emit(e) }
  const drafts = new Map<string, Finding>()
  let lastFindingId: string | null = null

  const persistAndEmit = (f: Finding) => { upsertFinding(req.chatId, f); emit({ type: 'finding', ...f }) }

  try {
    for (let step = 0; step < STEP_CAP; step++) {
      let assistantText = ''
      const result = streamText({ model, system: systemPrompt(req.engagementType, req.phaseLabel), messages, abortSignal: signal })
      for await (const delta of result.textStream) { assistantText += delta; emit({ type: 'text_delta', delta }) }

      const calls = parseSkillCalls(assistantText)
      if (calls.length === 0) break

      messages.push({ role: 'assistant', content: assistantText })
      const results: string[] = []

      for (const c of calls) {
        if (c.name === 'log_finding') {
          const id = randomUUID()
          const ev = evidenceFromArgs(c.args, registry)
          const evidence = ev ? [ev] : []
          const finding: Finding = {
            id, title: c.args.title ?? 'Untitled finding', sev: normalizeSev(c.args.sev),
            phase: c.args.phase ?? req.phaseLabel ?? '', time: 'just now',
            rationale: c.args.rationale ?? '', evidence, verified: computeVerified(evidence),
          }
          drafts.set(id, finding); lastFindingId = id
          persistAndEmit(finding)
          results.push(finding.verified
            ? `[finding ${id} logged, VERIFIED]`
            : `[finding ${id} logged, UNVERIFIED — attach evidence: SKILL_CALL[attach_evidence|finding=${id}|tool_output=SKILL_ID] or |host=HOST|detail=ISSUE]`)
        } else if (c.name === 'attach_evidence') {
          const fid = c.args.finding ?? lastFindingId ?? ''
          const finding = drafts.get(fid)
          if (!finding) { results.push(`[attach_evidence: unknown finding ${fid}]`); continue }
          const ev = evidenceFromArgs(c.args, registry)
          if (!ev) { results.push(`[finding ${finding.id} still UNVERIFIED — evidence did not resolve]`); continue }
          finding.evidence = [...finding.evidence, ev]
          finding.verified = computeVerified(finding.evidence)
          persistAndEmit(finding)
          results.push(`[finding ${finding.id} now VERIFIED]`)
        } else if (companyId && engagementId) {
          const skillDef = c.name === 'probe'
            ? { name: 'probe', build: () => ({ command: process.execPath, args: ['-e', `process.stdout.write('probe-output')`] }) }
            : AWS_SKILLS[c.name]
          if (!skillDef) { results.push(`[unknown skill ${c.name}]`); continue }
          const id = randomUUID()
          const inv: SkillInvocation = { skill: c.name, companyId, engagementId, account: c.args.account, region: c.args.region }
          const deps: RunDeps = { getScope, injectEnv, hasFilledSecret }
          await runSkill(inv, skillDef as any, recordingEmit, deps, id)
          results.push(`[skill ${c.name} ran, id=${id} — reference its output with tool_output=${id}]`)
        } else {
          results.push(`[skill ${c.name} unavailable: no engagement context]`)
        }
      }
      messages.push({ role: 'user', content: results.join('\n') })
    }
    emit({ type: 'done' })
  } catch (err) {
    if (signal.aborted || (err as Error)?.name === 'AbortError') { emit({ type: 'done' }); return }
    emit({ type: 'error', message: (err as Error).message })
  }
}
```

- [ ] **Step 5: Run the new + prior agent.live tests**

Run: `cd nexra && npx vitest run test/agent.live.findings.test.ts test/agent.live.test.ts`
Expected: PASS — the loop test passes and the existing `runSend` tests (plain text, error, abort, history) stay green (a no-skill reply still yields `[text_delta…, done]`).

- [ ] **Step 6: Full test + typecheck**

Run: `cd nexra && npx tsc --noEmit && npx vitest run`
Expected: PASS across the suite.

- [ ] **Step 7: Commit**

```bash
git add nexra/electron/services/agent.live.ts nexra/electron/services/agent.tools.ts nexra/test/agent.live.findings.test.ts
git commit -m "feat(m3c): tool-result continuation loop with evidence-gated log_finding/attach_evidence"
```

---

## Task 7: Thread companyId/engagementId into the live send path

**Files:**
- Modify: `nexra/electron/services/agent.types.ts:20-23` (`AgentSendRequest`)
- Modify: `nexra/electron/main.ts:68-72` (`agent:send` handler)
- Modify: `nexra/src/ipc.ts:58-72` (`sendMessage`)
- Modify: `nexra/src/components/ChatPane.tsx:25` (pass companyId)
- Test: `nexra/test/ipc.test.ts`

**Interfaces:**
- Consumes: `runSend(req, cfg, emit, signal, companyId?, engagementId?)` (Task 6).
- Produces: `AgentSendRequest` gains `companyId?: string; engagementId?: string`; `sendMessage(dispatch, chat, eng, text, companyId?)`.

- [ ] **Step 1: Write the failing test**

Add to `nexra/test/ipc.test.ts` `describe('sendMessage', ...)`:

```ts
  it('includes companyId and engagementId in the request so the agent loop can run skills', () => {
    const engWithId = { type: 'aws', id: 'eng-9', phases: [] } as unknown as Engagement
    sendMessage(() => {}, chat, engWithId, 'audit', 'co-42')
    expect(sent!.req.companyId).toBe('co-42')
    expect(sent!.req.engagementId).toBe('eng-9')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nexra && npx vitest run test/ipc.test.ts -t "companyId and engagementId"`
Expected: FAIL — `req.companyId` is undefined; `sendMessage` takes no 5th arg.

- [ ] **Step 3: Extend AgentSendRequest**

In `agent.types.ts`, replace the `AgentSendRequest` interface (lines 20-23) adding two optional fields:

```ts
export interface AgentSendRequest {
  chatId: string; engagementType: string; phaseLabel: string; primaryTool: string; text: string
  history: { role: 'user' | 'assistant'; content: string }[]
  companyId?: string; engagementId?: string
}
```

- [ ] **Step 4: Pass them from sendMessage**

In `ipc.ts`, change the signature (line 58) and the request built (lines 70-72):

```ts
export function sendMessage(dispatch: Dispatch<Action>, chat: Chat, eng: Engagement, text: string, companyId?: string): void {
```
```ts
  window.nexra.agent.send(
    { chatId: chat.id, engagementType: eng.type, phaseLabel: phaseLabel(eng, chat.phaseId), primaryTool, text: trimmed, history, companyId, engagementId: eng.id },
    applyEvent(dispatch, chat.id, runningIds),
  )
```

- [ ] **Step 5: Pass companyId from ChatPane**

In `ChatPane.tsx`, the component already has `const company = activeCompany(state)` (line 19). Update the `sendMessage` call (line 25):

```tsx
    sendMessage(dispatch, chat, eng, state.ui.draft, company?.id)
```

- [ ] **Step 6: Forward to runSend in main**

In `main.ts`, update the `agent:send` handler (line 72) to pass the ids through:

```ts
      await runSend(req, loadConfig(), e => ev.sender.send('agent:event:' + req.chatId, e), ctrl.signal, req.companyId, req.engagementId)
```

- [ ] **Step 7: Run tests + typecheck + build**

Run: `cd nexra && npx vitest run test/ipc.test.ts && npx tsc --noEmit && npm run build`
Expected: PASS; build clean.

- [ ] **Step 8: Commit**

```bash
git add nexra/electron/services/agent.types.ts nexra/src/ipc.ts nexra/src/components/ChatPane.tsx nexra/electron/main.ts nexra/test/ipc.test.ts
git commit -m "feat(m3c): thread companyId/engagementId into the live agent send path"
```

---

## Final verification

- [ ] **Whole-suite green + build:** `cd nexra && npx tsc --noEmit && npm run build && npx vitest run` — all tests pass, build clean.
- [ ] **Acceptance walkthrough (manual/dev, per spec §10):**
  - **M3c-1:** in `npm run dev`, the seeded Findings tab shows findings with a Verified badge that expand to rationale + evidence; a finding persisted to sqlite for a seeded chat reappears after an app restart.
  - **M3c-2:** with a live model configured, ask the agent to log a finding — it surfaces; if logged without evidence it reads Unverified and the agent's next loop step attaches evidence, flipping it to Verified. (A full run referencing real Prowler output additionally needs the AWS pack installed + an in-scope account + Task 7's live wiring — the milestone "Done when".)

## Notes for the executor

- **`SKILL_CALL` arg values must not contain `|` or `[`/`]`.** `detail=` should be a concise single-line string; the robust proof path is `tool_output`. (Spec §11.)
- **`attach_evidence` with no `finding=` targets the most recently logged finding in the turn** — deliberate, so the model needn't echo a dynamic id.
- **Rehydration is bounded by chat-id stability.** Seeded chats have stable ids so their findings rehydrate; chats created in a session are ephemeral until M4 persists chats. Do not "fix" this by inventing chat persistence here — it is M4.
- **Do not change `runSkill`'s existing 4-arg callers.** The new `id` param is optional and defaulted.
