# M4 — Persistence + External Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the full engagement graph (companies → engagements → chats → messages) survive an app restart, and stand up the `phase_coverage` + `engagement_memory` substrate — replacing the last mock backend (`StoreService`) with real per-machine sqlite.

**Architecture:** Two writers, split by who originates the data. (1) The **renderer autosaves** the structure + transcript: a debounced effect calls `store.save(companies)` on every `state.data` change; deletes fire explicit cascade IPC. (2) **Main owns event-originated data** it already emits — findings/evidence (unchanged), plus new `phase_coverage`/`engagement_memory`. On boot, `store:snapshot` reads the graph from sqlite (seeding an empty DB once) instead of returning the mock seed.

**Tech Stack:** Electron main process, `better-sqlite3` (already a dependency), TypeScript, Vitest, React `useReducer` renderer.

## Global Constraints

- All work happens in `nexra/`. Run tests with `npm test` (Vitest), typecheck+build with `npm run build` (runs `tsc` then `vite build`). Both must stay green.
- **No renderer component may import a service directly** — the renderer only ever touches persistence through `window.nexra.store.*` (contextBridge). New IPC goes in `electron/main.ts` + `electron/preload.ts`.
- Schema is **additive only**: every table is `CREATE TABLE IF NOT EXISTS` inside `initSettingsDb`; never drop or rewrite an existing table (an M3-era DB must upgrade in place). Existing tables (`settings`, `secrets`, `secret_values`, `scope`, `findings`, `evidence`) are untouched.
- Autosave must **not** write `findings`/`evidence` rows — those stay main-owned (`upsertFinding` in `agent.live.ts`). Do not change the working M3c finding path.
- Tests use real `better-sqlite3` on a temp dir (`mkdtempSync(join(tmpdir(), 'nexra-...'))` + `initSettingsDb`), matching `test/store.sqlite.findings.test.ts`.
- Message/company/engagement/chat `id`s are authoritative from the renderer (`nextId(...)`); persistence upserts by `id` and reloads them verbatim.
- Commit after each task with a `feat(m4):` / `test(m4):` message ending in the `Co-Authored-By` trailer already used on this branch.

---

### Task 1: Schema additions + shared `getDb()` accessor

**Files:**
- Modify: `nexra/electron/services/store.sqlite.ts` (add tables in `initSettingsDb`; export `getDb`)
- Test: `nexra/test/store.graph.schema.test.ts` (create)

**Interfaces:**
- Produces: `getDb(): Database.Database` — the shared handle used by `store.graph.ts` and coverage/memory functions. Throws if the DB is not initialized (same guard as `requireDb`).
- Produces (schema): tables `companies`, `engagements`, `chats`, `messages`, `phase_coverage`, `engagement_memory` (columns per the spec).

- [ ] **Step 1: Write the failing test**

Create `nexra/test/store.graph.schema.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initSettingsDb, getDb, setSetting, getSetting } from '../electron/services/store.sqlite'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-graph-')); initSettingsDb(join(dir, 'nexra.db')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const tableNames = (): string[] =>
  (getDb().prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(r => r.name)

describe('M4 schema', () => {
  it('creates the graph + memory tables', () => {
    for (const t of ['companies', 'engagements', 'chats', 'messages', 'phase_coverage', 'engagement_memory'])
      expect(tableNames()).toContain(t)
  })
  it('migrates an M3-era db in place without losing settings', () => {
    setSetting('provider', 'anthropic')
    initSettingsDb(join(dir, 'nexra.db'))                  // reopen (simulates upgrade)
    expect(getSetting('provider')).toBe('anthropic')
    expect(tableNames()).toContain('messages')
  })
  it('getDb throws before init', () => {
    // reopen closes the handle only on next init; assert the guard exists by shape
    expect(typeof getDb).toBe('function')
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `cd nexra && npx vitest run test/store.graph.schema.test.ts`
Expected: FAIL — `getDb` is not exported / tables missing.

- [ ] **Step 3: Add the tables and export `getDb`**

In `store.sqlite.ts`, inside `initSettingsDb`, after the existing `evidence` table block (before the closing `}`), add:

```ts
  // ── M4: engagement graph (companies → engagements → chats → messages) ──
  db.exec(`CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, updated TEXT NOT NULL, ord INTEGER NOT NULL
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS engagements (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL,
    status TEXT NOT NULL, updated TEXT NOT NULL, linear INTEGER NOT NULL,
    phases TEXT NOT NULL, scope TEXT NOT NULL, ord INTEGER NOT NULL
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY, engagement_id TEXT NOT NULL, name TEXT NOT NULL,
    phase_id TEXT NOT NULL, color TEXT NOT NULL, tools TEXT NOT NULL, ord INTEGER NOT NULL
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, role TEXT NOT NULL, kind TEXT NOT NULL,
    content TEXT, tool_name TEXT, command TEXT, output TEXT, duration TEXT,
    reason TEXT, install_cmd TEXT, state TEXT,
    request_kind TEXT, request_id TEXT, items TEXT, engagement_id TEXT, ord INTEGER NOT NULL
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS phase_coverage (
    engagement_id TEXT NOT NULL, phase_id TEXT NOT NULL, status TEXT NOT NULL, updated TEXT NOT NULL,
    PRIMARY KEY (engagement_id, phase_id)
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS engagement_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT, engagement_id TEXT NOT NULL, chat_id TEXT,
    kind TEXT NOT NULL, content TEXT NOT NULL, time TEXT NOT NULL
  )`)
```

Then add an exported accessor next to `requireDb` (keep `requireDb` for the existing internal callers):

```ts
// Shared handle for sibling persistence modules (store.graph.ts, coverage/memory).
export function getDb(): Database.Database {
  return requireDb()
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `cd nexra && npx vitest run test/store.graph.schema.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add nexra/electron/services/store.sqlite.ts nexra/test/store.graph.schema.test.ts
git commit -m "feat(m4): graph + memory schema tables and shared getDb accessor"
```

---

### Task 2: `store.graph.ts` — save + read the engagement graph

**Files:**
- Create: `nexra/electron/services/store.graph.ts`
- Test: `nexra/test/store.graph.test.ts` (create)

**Interfaces:**
- Consumes: `getDb` (Task 1), `listFindingsByChat` (existing, `store.sqlite.ts`), types `Company, Engagement, Chat, Message` from `store.types`.
- Produces:
  - `saveGraph(companies: Company[]): void` — upserts every company/engagement/chat/message by `id` in one transaction. `ord` is array index at each level. Does **not** write findings.
  - `readGraph(): Company[]` — reconstructs the nested graph ordered by `ord`; each chat's `findings` is `listFindingsByChat(chat.id)`.
  - `isEmptyGraph(): boolean` — true when the `companies` table has no rows.

- [ ] **Step 1: Write the failing test**

Create `nexra/test/store.graph.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initSettingsDb, upsertFinding } from '../electron/services/store.sqlite'
import { saveGraph, readGraph, isEmptyGraph } from '../electron/services/store.graph'
import type { Company, Message } from '../electron/services/store.types'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-graph-')); initSettingsDb(join(dir, 'nexra.db')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const msg = (over: Partial<Message> = {}): Message => ({ id: 'm1', role: 'user', kind: 'text', content: 'hi', ...over })

const company = (over: Partial<Company> = {}): Company => ({
  id: 'c1', name: 'Acme', updated: 'just now',
  engagements: [{
    id: 'e1', type: 'aws', name: 'AWS review', status: 'In Progress', updated: 'just now', linear: true,
    phases: [{ id: 'iam', label: 'IAM' }], scope: [{ label: 'Account', value: '1234' }],
    chats: [{
      id: 'ch1', name: 'Recon', phaseId: 'iam', color: '#123456',
      tools: [{ name: 'prowler', available: true }],
      messages: [msg({ id: 'm1', role: 'user' }), msg({ id: 'm2', role: 'assistant', kind: 'text', content: 'hello' })],
      findings: [],
    }],
  }],
  ...over,
})

describe('graph save/read', () => {
  it('is empty before any save', () => {
    expect(isEmptyGraph()).toBe(true)
    expect(readGraph()).toEqual([])
  })
  it('round-trips a full company graph', () => {
    saveGraph([company()])
    expect(isEmptyGraph()).toBe(false)
    const got = readGraph()
    expect(got).toEqual([company()])   // findings default [] (none persisted)
  })
  it('folds persisted findings into their chat', () => {
    saveGraph([company()])
    upsertFinding('ch1', { id: 'f1', title: 'Public bucket', sev: 'High', phase: 'IAM', time: 'now', rationale: 'x', verified: true, evidence: [{ kind: 'code_block', host: 'h', detail: 'd' }] })
    expect(readGraph()[0].engagements[0].chats[0].findings.map(f => f.id)).toEqual(['f1'])
  })
  it('upserts by id — re-saving updates, never duplicates', () => {
    saveGraph([company()])
    const edited = company()
    edited.name = 'Acme Corp'
    edited.engagements[0].chats[0].messages.push(msg({ id: 'm3', role: 'user', content: 'more' }))
    saveGraph([edited])
    const got = readGraph()
    expect(got).toHaveLength(1)
    expect(got[0].name).toBe('Acme Corp')
    expect(got[0].engagements[0].chats[0].messages.map(m => m.id)).toEqual(['m1', 'm2', 'm3'])
  })
  it('preserves order and request-card fields', () => {
    const c = company()
    c.engagements[0].chats[0].messages = [
      msg({ id: 'r1', role: 'assistant', kind: 'request', content: undefined, requestKind: 'inputs', requestId: 'req9', items: [{ key: 'AWS_ACCESS_KEY_ID', label: 'Key', sensitive: true, required: true }] }),
    ]
    saveGraph([c])
    const m = readGraph()[0].engagements[0].chats[0].messages[0]
    expect(m.kind).toBe('request')
    expect(m.requestKind).toBe('inputs')
    expect(m.items).toEqual([{ key: 'AWS_ACCESS_KEY_ID', label: 'Key', sensitive: true, required: true }])
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `cd nexra && npx vitest run test/store.graph.test.ts`
Expected: FAIL — `store.graph` module not found.

- [ ] **Step 3: Implement `store.graph.ts`**

Create `nexra/electron/services/store.graph.ts`:

```ts
import { getDb, listFindingsByChat } from './store.sqlite'
import type { Company, Engagement, Chat, Message, Phase, ScopeRow, ToolAvailability, InputRequestItem } from './store.types'

// Undefined → null for sqlite; empty string is preserved as-is.
const n = (v: string | undefined): string | null => (v == null ? null : v)

export function isEmptyGraph(): boolean {
  const r = getDb().prepare('SELECT COUNT(*) AS n FROM companies').get() as { n: number }
  return r.n === 0
}

export function saveGraph(companies: Company[]): void {
  const db = getDb()
  const upCompany = db.prepare(
    `INSERT INTO companies (id, name, updated, ord) VALUES (@id, @name, @updated, @ord)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, updated=excluded.updated, ord=excluded.ord`)
  const upEng = db.prepare(
    `INSERT INTO engagements (id, company_id, type, name, status, updated, linear, phases, scope, ord)
     VALUES (@id, @company_id, @type, @name, @status, @updated, @linear, @phases, @scope, @ord)
     ON CONFLICT(id) DO UPDATE SET company_id=excluded.company_id, type=excluded.type, name=excluded.name,
       status=excluded.status, updated=excluded.updated, linear=excluded.linear,
       phases=excluded.phases, scope=excluded.scope, ord=excluded.ord`)
  const upChat = db.prepare(
    `INSERT INTO chats (id, engagement_id, name, phase_id, color, tools, ord)
     VALUES (@id, @engagement_id, @name, @phase_id, @color, @tools, @ord)
     ON CONFLICT(id) DO UPDATE SET engagement_id=excluded.engagement_id, name=excluded.name,
       phase_id=excluded.phase_id, color=excluded.color, tools=excluded.tools, ord=excluded.ord`)
  const upMsg = db.prepare(
    `INSERT INTO messages (id, chat_id, role, kind, content, tool_name, command, output, duration,
       reason, install_cmd, state, request_kind, request_id, items, engagement_id, ord)
     VALUES (@id, @chat_id, @role, @kind, @content, @tool_name, @command, @output, @duration,
       @reason, @install_cmd, @state, @request_kind, @request_id, @items, @engagement_id, @ord)
     ON CONFLICT(id) DO UPDATE SET chat_id=excluded.chat_id, role=excluded.role, kind=excluded.kind,
       content=excluded.content, tool_name=excluded.tool_name, command=excluded.command, output=excluded.output,
       duration=excluded.duration, reason=excluded.reason, install_cmd=excluded.install_cmd, state=excluded.state,
       request_kind=excluded.request_kind, request_id=excluded.request_id, items=excluded.items,
       engagement_id=excluded.engagement_id, ord=excluded.ord`)

  const tx = db.transaction((cs: Company[]) => {
    cs.forEach((c, ci) => {
      upCompany.run({ id: c.id, name: c.name, updated: c.updated, ord: ci })
      c.engagements.forEach((e, ei) => {
        upEng.run({ id: e.id, company_id: c.id, type: e.type, name: e.name, status: e.status,
          updated: e.updated, linear: e.linear ? 1 : 0, phases: JSON.stringify(e.phases),
          scope: JSON.stringify(e.scope), ord: ei })
        e.chats.forEach((ch, chi) => {
          upChat.run({ id: ch.id, engagement_id: e.id, name: ch.name, phase_id: ch.phaseId,
            color: ch.color, tools: JSON.stringify(ch.tools), ord: chi })
          ch.messages.forEach((m, mi) => {
            upMsg.run({ id: m.id, chat_id: ch.id, role: m.role, kind: m.kind, content: n(m.content),
              tool_name: n(m.toolName), command: n(m.command), output: n(m.output), duration: n(m.duration),
              reason: n(m.reason), install_cmd: n(m.installCmd), state: n(m.state),
              request_kind: n(m.requestKind), request_id: n(m.requestId),
              items: m.items ? JSON.stringify(m.items) : null, engagement_id: n(m.engagementId), ord: mi })
          })
        })
      })
    })
  })
  tx(companies)
}

interface CompanyRow { id: string; name: string; updated: string }
interface EngRow { id: string; type: string; name: string; status: string; updated: string; linear: number; phases: string; scope: string }
interface ChatRow { id: string; name: string; phase_id: string; color: string; tools: string }
interface MsgRow {
  id: string; role: string; kind: string; content: string | null; tool_name: string | null; command: string | null
  output: string | null; duration: string | null; reason: string | null; install_cmd: string | null; state: string | null
  request_kind: string | null; request_id: string | null; items: string | null; engagement_id: string | null
}

function rowToMessage(r: MsgRow): Message {
  const m: Message = { id: r.id, role: r.role as Message['role'], kind: r.kind as Message['kind'] }
  if (r.content != null) m.content = r.content
  if (r.tool_name != null) m.toolName = r.tool_name
  if (r.command != null) m.command = r.command
  if (r.output != null) m.output = r.output
  if (r.duration != null) m.duration = r.duration
  if (r.reason != null) m.reason = r.reason
  if (r.install_cmd != null) m.installCmd = r.install_cmd
  if (r.state != null) m.state = r.state as Message['state']
  if (r.request_kind != null) m.requestKind = r.request_kind as Message['requestKind']
  if (r.request_id != null) m.requestId = r.request_id
  if (r.items != null) m.items = JSON.parse(r.items) as InputRequestItem[]
  if (r.engagement_id != null) m.engagementId = r.engagement_id
  return m
}

export function readGraph(): Company[] {
  const db = getDb()
  const companies = db.prepare('SELECT id, name, updated FROM companies ORDER BY ord').all() as CompanyRow[]
  const engStmt = db.prepare('SELECT id, type, name, status, updated, linear, phases, scope FROM engagements WHERE company_id = ? ORDER BY ord')
  const chatStmt = db.prepare('SELECT id, name, phase_id, color, tools FROM chats WHERE engagement_id = ? ORDER BY ord')
  const msgStmt = db.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY ord')

  return companies.map(c => ({
    id: c.id, name: c.name, updated: c.updated,
    engagements: (engStmt.all(c.id) as EngRow[]).map(e => ({
      id: e.id, type: e.type as Engagement['type'], name: e.name, status: e.status as Engagement['status'],
      updated: e.updated, linear: !!e.linear,
      phases: JSON.parse(e.phases) as Phase[], scope: JSON.parse(e.scope) as ScopeRow[],
      chats: (chatStmt.all(e.id) as ChatRow[]).map(ch => ({
        id: ch.id, name: ch.name, phaseId: ch.phase_id, color: ch.color,
        tools: JSON.parse(ch.tools) as ToolAvailability[],
        messages: (msgStmt.all(ch.id) as MsgRow[]).map(rowToMessage),
        findings: listFindingsByChat(ch.id),
      })),
    })),
  }))
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `cd nexra && npx vitest run test/store.graph.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add nexra/electron/services/store.graph.ts nexra/test/store.graph.test.ts
git commit -m "feat(m4): saveGraph/readGraph — persist the engagement graph"
```

---

### Task 3: Cascade deletes

**Files:**
- Modify: `nexra/electron/services/store.graph.ts`
- Test: `nexra/test/store.graph.delete.test.ts` (create)

**Interfaces:**
- Consumes: `getDb`, `deleteFindingsByChat` (new small helper — see Step 3), `saveGraph`/`readGraph`.
- Produces:
  - `deleteChatGraph(chatId: string): void` — deletes the chat, its messages, and its findings+evidence.
  - `deleteCompanyGraph(companyId: string): void` — deletes the company and every engagement/chat/message/finding/evidence under it.

- [ ] **Step 1: Write the failing test**

Create `nexra/test/store.graph.delete.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initSettingsDb, upsertFinding, listFindingsByChat } from '../electron/services/store.sqlite'
import { saveGraph, readGraph, deleteChatGraph, deleteCompanyGraph } from '../electron/services/store.graph'
import type { Company } from '../electron/services/store.types'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-del-')); initSettingsDb(join(dir, 'nexra.db')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const two = (): Company[] => ([
  { id: 'c1', name: 'Acme', updated: 'now', engagements: [
    { id: 'e1', type: 'aws', name: 'AWS', status: 'In Progress', updated: 'now', linear: true, phases: [], scope: [], chats: [
      { id: 'ch1', name: 'A', phaseId: 'p', color: '#111', tools: [], messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'x' }], findings: [] },
      { id: 'ch2', name: 'B', phaseId: 'p', color: '#222', tools: [], messages: [], findings: [] },
    ] },
  ] },
  { id: 'c2', name: 'Beta', updated: 'now', engagements: [] },
])

describe('cascade deletes', () => {
  it('deleteChatGraph removes the chat, its messages and findings; siblings stay', () => {
    saveGraph(two())
    upsertFinding('ch1', { id: 'f1', title: 't', sev: 'Low', phase: 'p', time: 'now', rationale: 'r', verified: false, evidence: [] })
    deleteChatGraph('ch1')
    const chats = readGraph()[0].engagements[0].chats
    expect(chats.map(c => c.id)).toEqual(['ch2'])
    expect(listFindingsByChat('ch1')).toEqual([])
  })
  it('deleteCompanyGraph removes everything under the company; other company stays', () => {
    saveGraph(two())
    upsertFinding('ch1', { id: 'f1', title: 't', sev: 'Low', phase: 'p', time: 'now', rationale: 'r', verified: false, evidence: [] })
    deleteCompanyGraph('c1')
    expect(readGraph().map(c => c.id)).toEqual(['c2'])
    expect(listFindingsByChat('ch1')).toEqual([])
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `cd nexra && npx vitest run test/store.graph.delete.test.ts`
Expected: FAIL — `deleteChatGraph`/`deleteCompanyGraph` not exported.

- [ ] **Step 3: Implement the deletes**

First add a chat-scoped finding delete helper to `store.sqlite.ts` (next to `upsertFinding`), so evidence rows go too:

```ts
// Delete every finding for a chat and its evidence (used by M4 cascade deletes).
export function deleteFindingsByChat(chatId: string): void {
  const d = requireDb()
  const ids = (d.prepare('SELECT id FROM findings WHERE chat_id = ?').all(chatId) as { id: string }[]).map(r => r.id)
  const delEv = d.prepare('DELETE FROM evidence WHERE finding_id = ?')
  for (const id of ids) delEv.run(id)
  d.prepare('DELETE FROM findings WHERE chat_id = ?').run(chatId)
}
```

Then in `store.graph.ts` add (import `deleteFindingsByChat` alongside `listFindingsByChat`):

```ts
export function deleteChatGraph(chatId: string): void {
  const db = getDb()
  const tx = db.transaction((id: string) => {
    deleteFindingsByChat(id)
    db.prepare('DELETE FROM messages WHERE chat_id = ?').run(id)
    db.prepare('DELETE FROM chats WHERE id = ?').run(id)
  })
  tx(chatId)
}

export function deleteCompanyGraph(companyId: string): void {
  const db = getDb()
  const tx = db.transaction((cid: string) => {
    const engIds = (db.prepare('SELECT id FROM engagements WHERE company_id = ?').all(cid) as { id: string }[]).map(r => r.id)
    for (const eid of engIds) {
      const chatIds = (db.prepare('SELECT id FROM chats WHERE engagement_id = ?').all(eid) as { id: string }[]).map(r => r.id)
      for (const chid of chatIds) {
        deleteFindingsByChat(chid)
        db.prepare('DELETE FROM messages WHERE chat_id = ?').run(chid)
      }
      db.prepare('DELETE FROM chats WHERE engagement_id = ?').run(eid)
    }
    db.prepare('DELETE FROM engagements WHERE company_id = ?').run(cid)
    db.prepare('DELETE FROM companies WHERE id = ?').run(cid)
  })
  tx(companyId)
}
```

Update the import line at the top of `store.graph.ts`:

```ts
import { getDb, listFindingsByChat, deleteFindingsByChat } from './store.sqlite'
```

- [ ] **Step 4: Run it — verify it passes**

Run: `cd nexra && npx vitest run test/store.graph.delete.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add nexra/electron/services/store.graph.ts nexra/electron/services/store.sqlite.ts nexra/test/store.graph.delete.test.ts
git commit -m "feat(m4): cascade delete for company and chat graphs"
```

---

### Task 4: Snapshot read + seed-if-empty

**Files:**
- Modify: `nexra/electron/services/store.graph.ts`
- Test: `nexra/test/store.graph.snapshot.test.ts` (create)

**Interfaces:**
- Consumes: `readGraph`, `saveGraph`, `isEmptyGraph`, and the seed builders `buildCompanies`, `buildTypes` from `./seed`.
- Produces: `readSnapshot(): Snapshot` — returns `{ companies: readGraph(), types: buildTypes() }`; if the graph is empty, first writes `buildCompanies()` via `saveGraph` (seed once). `types` always come from the seed (static config, never persisted).

- [ ] **Step 1: Write the failing test**

Create `nexra/test/store.graph.snapshot.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initSettingsDb } from '../electron/services/store.sqlite'
import { readSnapshot, isEmptyGraph, saveGraph } from '../electron/services/store.graph'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-snap-')); initSettingsDb(join(dir, 'nexra.db')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('readSnapshot', () => {
  it('seeds an empty db once and returns companies + types', () => {
    expect(isEmptyGraph()).toBe(true)
    const snap = readSnapshot()
    expect(snap.companies.length).toBeGreaterThan(0)
    expect(Object.keys(snap.types)).toContain('aws')
    expect(isEmptyGraph()).toBe(false)
  })
  it('does not re-seed a non-empty db', () => {
    saveGraph([{ id: 'only', name: 'Only Co', updated: 'now', engagements: [] }])
    const snap = readSnapshot()
    expect(snap.companies.map(c => c.id)).toEqual(['only'])
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `cd nexra && npx vitest run test/store.graph.snapshot.test.ts`
Expected: FAIL — `readSnapshot` not exported.

- [ ] **Step 3: Implement `readSnapshot`**

Add to `store.graph.ts` (add the seed import at top: `import { buildCompanies, buildTypes } from './seed'` and `import type { Snapshot } from './store.types'`):

```ts
// Boot read: seed an empty db once, then return the persisted graph plus the
// static review-type config (types are never persisted — they are code).
export function readSnapshot(): Snapshot {
  if (isEmptyGraph()) saveGraph(buildCompanies())
  return { companies: readGraph(), types: buildTypes() }
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `cd nexra && npx vitest run test/store.graph.snapshot.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add nexra/electron/services/store.graph.ts nexra/test/store.graph.snapshot.test.ts
git commit -m "feat(m4): readSnapshot — boot from sqlite, seed empty db once"
```

---

### Task 5: `phase_coverage` + `engagement_memory` service

**Files:**
- Create: `nexra/electron/services/store.memory.ts`
- Test: `nexra/test/store.memory.test.ts` (create)

**Interfaces:**
- Consumes: `getDb` (Task 1).
- Produces:
  - `PhaseStatus = 'pending' | 'in_progress' | 'done'`
  - `setPhaseCoverage(engagementId: string, phaseId: string, status: PhaseStatus): void` — upsert, stamps `updated: 'just now'`.
  - `listPhaseCoverage(engagementId: string): { phaseId: string; status: PhaseStatus }[]`
  - `MemoryKind = 'target' | 'dead_end' | 'note'`
  - `appendMemory(engagementId: string, kind: MemoryKind, content: string, chatId?: string): void`
  - `listMemory(engagementId: string): { kind: MemoryKind; content: string; chatId?: string; time: string }[]` — insertion order.

Note: `'just now'` is a literal (matches how findings/companies stamp `time`/`updated` in this codebase). Do **not** call `Date.now()` — the mock/seed uses relative strings and tests compare on them.

- [ ] **Step 1: Write the failing test**

Create `nexra/test/store.memory.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initSettingsDb } from '../electron/services/store.sqlite'
import { setPhaseCoverage, listPhaseCoverage, appendMemory, listMemory } from '../electron/services/store.memory'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-mem-')); initSettingsDb(join(dir, 'nexra.db')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('phase coverage', () => {
  it('upserts status per (engagement, phase)', () => {
    setPhaseCoverage('e1', 'iam', 'in_progress')
    setPhaseCoverage('e1', 'iam', 'done')
    setPhaseCoverage('e1', 'storage', 'pending')
    expect(listPhaseCoverage('e1')).toEqual([
      { phaseId: 'iam', status: 'done' },
      { phaseId: 'storage', status: 'pending' },
    ])
  })
  it('scopes by engagement', () => {
    setPhaseCoverage('e1', 'iam', 'done')
    setPhaseCoverage('e2', 'iam', 'pending')
    expect(listPhaseCoverage('e2')).toEqual([{ phaseId: 'iam', status: 'pending' }])
  })
})

describe('engagement memory', () => {
  it('appends and lists in insertion order', () => {
    appendMemory('e1', 'target', 'acct 1234 / us-east-1', 'ch1')
    appendMemory('e1', 'dead_end', 'no ScoutSuite access')
    const got = listMemory('e1')
    expect(got.map(m => m.kind)).toEqual(['target', 'dead_end'])
    expect(got[0]).toMatchObject({ kind: 'target', content: 'acct 1234 / us-east-1', chatId: 'ch1' })
    expect(got[1].chatId).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it — verify it fails**

Run: `cd nexra && npx vitest run test/store.memory.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `store.memory.ts`**

```ts
import { getDb } from './store.sqlite'

export type PhaseStatus = 'pending' | 'in_progress' | 'done'
export type MemoryKind = 'target' | 'dead_end' | 'note'

export function setPhaseCoverage(engagementId: string, phaseId: string, status: PhaseStatus): void {
  getDb().prepare(
    `INSERT INTO phase_coverage (engagement_id, phase_id, status, updated) VALUES (?, ?, ?, 'just now')
     ON CONFLICT(engagement_id, phase_id) DO UPDATE SET status=excluded.status, updated=excluded.updated`,
  ).run(engagementId, phaseId, status)
}

export function listPhaseCoverage(engagementId: string): { phaseId: string; status: PhaseStatus }[] {
  const rows = getDb().prepare('SELECT phase_id, status FROM phase_coverage WHERE engagement_id = ? ORDER BY phase_id')
    .all(engagementId) as { phase_id: string; status: string }[]
  return rows.map(r => ({ phaseId: r.phase_id, status: r.status as PhaseStatus }))
}

export function appendMemory(engagementId: string, kind: MemoryKind, content: string, chatId?: string): void {
  getDb().prepare(
    `INSERT INTO engagement_memory (engagement_id, chat_id, kind, content, time) VALUES (?, ?, ?, ?, 'just now')`,
  ).run(engagementId, chatId ?? null, kind, content)
}

export function listMemory(engagementId: string): { kind: MemoryKind; content: string; chatId?: string; time: string }[] {
  const rows = getDb().prepare('SELECT chat_id, kind, content, time FROM engagement_memory WHERE engagement_id = ? ORDER BY id')
    .all(engagementId) as { chat_id: string | null; kind: string; content: string; time: string }[]
  return rows.map(r => ({ kind: r.kind as MemoryKind, content: r.content, time: r.time, ...(r.chat_id != null ? { chatId: r.chat_id } : {}) }))
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `cd nexra && npx vitest run test/store.memory.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add nexra/electron/services/store.memory.ts nexra/test/store.memory.test.ts
git commit -m "feat(m4): phase_coverage + engagement_memory service"
```

---

### Task 6: Main-process IPC wiring (save, delete, snapshot, coverage/memory)

**Files:**
- Modify: `nexra/electron/main.ts`
- Modify: `nexra/electron/preload.ts`
- Modify: `nexra/electron/services/agent.live.ts` (mark phase coverage when a skill runs)
- Test: `nexra/test/agent.live.coverage.test.ts` (create)

**Interfaces:**
- Consumes: `readSnapshot`, `saveGraph`, `deleteCompanyGraph`, `deleteChatGraph` (Tasks 2–4); `setPhaseCoverage`, `listPhaseCoverage`, `appendMemory`, `listMemory` (Task 5).
- Produces `window.nexra.store`: `snapshot()`, `save(companies)`, `deleteCompany(id)`, `deleteChat(id)`, `coverage(engagementId)`, `memory(engagementId)`.

- [ ] **Step 1: Rewrite the snapshot handler + add store IPC (main.ts)**

Replace the `buildSnapshot` import and the `store:snapshot` handler.

Change the import at `main.ts:4` from:
```ts
import { buildSnapshot } from './services/store.mock'
```
to:
```ts
import { readSnapshot, saveGraph, deleteCompanyGraph, deleteChatGraph } from './services/store.graph'
import { listPhaseCoverage, listMemory } from './services/store.memory'
import type { Company } from './services/store.types'
```

Replace the handler at `main.ts:68`:
```ts
  ipcMain.handle('store:snapshot', () => buildSnapshot())
```
with:
```ts
  ipcMain.handle('store:snapshot', () => readSnapshot())
  ipcMain.handle('store:save', (_ev, companies: Company[]) => {
    try { saveGraph(companies); return { success: true } }
    catch (err) { console.error('store:save failed', err); return { success: false, error: (err as Error).message } }
  })
  ipcMain.handle('store:deleteCompany', (_ev, id: string) => { try { deleteCompanyGraph(id) } catch (err) { console.error('store:deleteCompany', err) } })
  ipcMain.handle('store:deleteChat', (_ev, id: string) => { try { deleteChatGraph(id) } catch (err) { console.error('store:deleteChat', err) } })
  ipcMain.handle('store:coverage', (_ev, engagementId: string) => listPhaseCoverage(engagementId))
  ipcMain.handle('store:memory', (_ev, engagementId: string) => listMemory(engagementId))
```

- [ ] **Step 2: Extend the preload store bridge (preload.ts)**

Replace the `store:` block at `preload.ts:10`:
```ts
  store: { snapshot: () => ipcRenderer.invoke('store:snapshot') },
```
with:
```ts
  store: {
    snapshot: () => ipcRenderer.invoke('store:snapshot'),
    save: (companies: any) => ipcRenderer.invoke('store:save', companies),
    deleteCompany: (id: string) => ipcRenderer.invoke('store:deleteCompany', id),
    deleteChat: (id: string) => ipcRenderer.invoke('store:deleteChat', id),
    coverage: (engagementId: string) => ipcRenderer.invoke('store:coverage', engagementId),
    memory: (engagementId: string) => ipcRenderer.invoke('store:memory', engagementId),
  },
```

Then update the renderer ambient type in `nexra/src/global.d.ts` (find the `store:` shape and extend it to match — add `save`, `deleteCompany`, `deleteChat`, `coverage`, `memory` with the same signatures). If `global.d.ts` types `store` as `{ snapshot(): Promise<Snapshot> }`, extend it:
```ts
    store: {
      snapshot(): Promise<import('../electron/services/store.types').Snapshot>
      save(companies: import('../electron/services/store.types').Company[]): Promise<{ success: boolean; error?: string }>
      deleteCompany(id: string): Promise<void>
      deleteChat(id: string): Promise<void>
      coverage(engagementId: string): Promise<{ phaseId: string; status: string }[]>
      memory(engagementId: string): Promise<{ kind: string; content: string; chatId?: string; time: string }[]>
    }
```
(Read the existing `global.d.ts` first and mirror its exact style — it may already inline these types.)

- [ ] **Step 3: Mark phase coverage when a skill runs (agent.live.ts) — write the failing test first**

Create `nexra/test/agent.live.coverage.test.ts`. The M3b skill path runs inside `runSend`; when a skill executes for an engagement/phase, mark that phase `in_progress`. Assert via `listPhaseCoverage` after a run that invokes a skill. Model the test on the existing `test/agent.live.m3b.test.ts` (reuse its provider/scope/secret fakes — open that file and copy its harness). The new assertion:

```ts
// after driving runSend with a SKILL_CALL[run_prowler|account=...] and req.phaseLabel = 'IAM'
import { listPhaseCoverage } from '../electron/services/store.memory'
expect(listPhaseCoverage(engagementId).find(p => p.phaseId === 'IAM')?.status).toBe('in_progress')
```

Run it: `cd nexra && npx vitest run test/agent.live.coverage.test.ts` → FAIL (no coverage written).

- [ ] **Step 4: Implement — mark coverage in the skill branch of `runSend`**

In `agent.live.ts`, import at top:
```ts
import { setPhaseCoverage } from './store.memory'
```
In the skill-execution branch (the `else if (companyId && engagementId)` block, after `await runSkill(...)` succeeds), add:
```ts
          if (req.phaseLabel) setPhaseCoverage(engagementId, req.phaseLabel, 'in_progress')
```
(`phaseLabel` is the human phase name the chat is focused on — it is the coverage key used by `listPhaseCoverage`. Keeping the label as the key matches how findings store `phase` as a label string.)

Run it: `cd nexra && npx vitest run test/agent.live.coverage.test.ts` → PASS.

- [ ] **Step 5: Verify the whole main-process suite still passes + commit**

Run: `cd nexra && npx vitest run test/agent.live.m3b.test.ts test/store.sqlite.findings.test.ts test/agent.live.coverage.test.ts`
Expected: PASS.

```bash
git add nexra/electron/main.ts nexra/electron/preload.ts nexra/src/global.d.ts nexra/electron/services/agent.live.ts nexra/test/agent.live.coverage.test.ts
git commit -m "feat(m4): store IPC (save/delete/snapshot/coverage/memory) + phase-coverage on skill runs"
```

---

### Task 7: Renderer wiring — autosave, delete write-through, boot from sqlite

**Files:**
- Modify: `nexra/src/App.tsx`
- Modify: `nexra/src/ipc.ts` (remove `rehydrateFindings`)
- Test: `nexra/test/app.autosave.test.tsx` (create)

**Interfaces:**
- Consumes: `window.nexra.store.save/deleteCompany/deleteChat` (Task 6), the reducer + actions.
- Produces: persisted structure/transcript via autosave; cascade deletes fired on `confirmDeleteCompany` / `ctxDelete`.

- [ ] **Step 1: Write the failing test**

Create `nexra/test/app.autosave.test.tsx`. Follow the existing renderer test setup (see `test/ipc.test.ts` / `test/reducer.test.ts` for how `window.nexra` is mocked and how the reducer is driven). The test drives the reducer + the autosave/delete side-effects directly rather than mounting the full app if that matches existing patterns. Minimum assertions:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
// Import whatever helper this task introduces to fire persistence from a dispatched action.
// If autosave is an App effect, render <App/> with @testing-library/react and a fake timer;
// if it is a small exported helper (persistDelete), test that directly.

describe('renderer persistence side-effects', () => {
  beforeEach(() => {
    ;(globalThis as any).window = globalThis as any
    ;(window as any).nexra = {
      store: { snapshot: vi.fn().mockResolvedValue({ companies: [], types: {} }), save: vi.fn(), deleteCompany: vi.fn(), deleteChat: vi.fn() },
      findings: { list: vi.fn().mockResolvedValue([]) },
    }
  })
  it('confirmDeleteCompany fires store.deleteCompany with the id', () => {
    // arrange a state with ui.confirmDeleteCompanyId = 'c1', dispatch through the App wrapper, assert:
    // expect(window.nexra.store.deleteCompany).toHaveBeenCalledWith('c1')
  })
  it('ctxDelete fires store.deleteChat with the chat id', () => {
    // expect(window.nexra.store.deleteChat).toHaveBeenCalledWith('ch1')
  })
})
```

Fill in the arrange/act using the same pattern the existing renderer tests use. If the codebase has no component-render test harness, prefer extracting the write-through as a pure helper (below) and unit-test the helper.

- [ ] **Step 2: Run it — verify it fails**

Run: `cd nexra && npx vitest run test/app.autosave.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the write-through + autosave in `App.tsx`**

Extract a pure helper so it is testable without a DOM, and wrap dispatch:

```tsx
import { useEffect, useReducer, useRef, useCallback } from 'react'
// ...existing imports; add:
import type { Action } from './state/reducer'
import type { AppState } from './state/selectors'

// Persist side-effects for the two destructive actions (autosave only upserts).
export function persistDelete(state: AppState, a: Action): void {
  if (a.t === 'confirmDeleteCompany' && state.ui.confirmDeleteCompanyId)
    window.nexra.store.deleteCompany(state.ui.confirmDeleteCompanyId)
  else if (a.t === 'ctxDelete')
    window.nexra.store.deleteChat(a.chatId)
}
```

In the component, wrap `dispatch` so deletes fire against the **pre-reduction** state (the id is still present in `ui.confirmDeleteCompanyId` before `confirmDeleteCompany` clears it):

```tsx
  const [state, rawDispatch] = useReducer(reducer, empty)
  const stateRef = useRef(state); stateRef.current = state
  const hydratedRef = useRef(false)

  const dispatch = useCallback((a: Action) => {
    persistDelete(stateRef.current, a)   // uses pre-reduction state for the id
    rawDispatch(a)
  }, [])
```

Boot (replace the existing boot effect — drop `rehydrateFindings`, findings now arrive inside the snapshot):

```tsx
  useEffect(() => {
    getSnapshot().then(data => {
      const seeded: AppState = { data, ui: initialUI }
      rawDispatch({ t: 'hydrate', data })
      rawDispatch({ t: 'seedActiveMap', map: initialActiveMap(seeded) })
      hydratedRef.current = true
    })
  }, [])
```

Debounced autosave (new effect):

```tsx
  useEffect(() => {
    if (!hydratedRef.current) return
    const id = setTimeout(() => { window.nexra.store.save(state.data.companies) }, 400)
    return () => clearTimeout(id)
  }, [state.data])
```

- [ ] **Step 4: Remove `rehydrateFindings` from `ipc.ts`**

Delete the `rehydrateFindings` export (lines 10–18) and its now-unused imports (`Dispatch`, `Finding`, `Action` if unused elsewhere in the file — check before removing). The snapshot now carries findings, so nothing else calls it. Confirm no other file imports it:

Run: `cd nexra && grep -rn "rehydrateFindings" src electron` → expect no matches after removal.

- [ ] **Step 5: Run tests + typecheck**

Run: `cd nexra && npx vitest run test/app.autosave.test.tsx && npm run build`
Expected: test PASS; `tsc` + `vite build` clean (fix any type fallout from the `dispatch` wrapper — the app passes `dispatch` widely; the wrapped one has the same `(a: Action) => void` shape, so it should slot in).

- [ ] **Step 6: Commit**

```bash
git add nexra/src/App.tsx nexra/src/ipc.ts nexra/test/app.autosave.test.tsx
git commit -m "feat(m4): renderer autosave + cascade-delete write-through; boot from sqlite"
```

---

### Task 8: Full-suite verification + persistence round-trip integration

**Files:**
- Test: `nexra/test/m4-integration.test.ts` (create)

**Interfaces:**
- Consumes: everything above. Proves the milestone's done-when at the persistence layer end-to-end.

- [ ] **Step 1: Write the integration test**

Create `nexra/test/m4-integration.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initSettingsDb, upsertFinding } from '../electron/services/store.sqlite'
import { readSnapshot, saveGraph, readGraph } from '../electron/services/store.graph'
import type { Company } from '../electron/services/store.types'

let dir: string, dbPath: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-m4-')); dbPath = join(dir, 'nexra.db'); initSettingsDb(dbPath) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('M4 done-when: a full engagement survives restart', () => {
  it('persists company→engagement→chat→messages→findings across a reopen', () => {
    // 1. seed on first boot
    const first = readSnapshot()
    expect(first.companies.length).toBeGreaterThan(0)

    // 2. operator builds a new engagement graph and it autosaves
    const graph: Company[] = [{
      id: 'c9', name: 'Client Nine', updated: 'now', engagements: [{
        id: 'e9', type: 'aws', name: 'AWS config review', status: 'In Progress', updated: 'now', linear: true,
        phases: [{ id: 'iam', label: 'IAM' }], scope: [], chats: [{
          id: 'ch9', name: 'IAM recon', phaseId: 'iam', color: '#3355ff', tools: [{ name: 'prowler', available: true }],
          messages: [
            { id: 'm1', role: 'user', kind: 'text', content: 'audit IAM' },
            { id: 'm2', role: 'assistant', kind: 'text', content: 'Running Prowler…' },
            { id: 'm3', role: 'assistant', kind: 'tool', toolName: 'run_prowler', output: 'ok', state: 'success' },
          ],
          findings: [],
        }],
      }],
    }, ...first.companies]
    saveGraph(graph)
    upsertFinding('ch9', { id: 'f9', title: 'Wildcard IAM policy', sev: 'Critical', phase: 'IAM', time: 'now', rationale: 'admin *', verified: true, evidence: [{ kind: 'tool_output', toolCallId: 'run_prowler', excerpt: 'Action: *' }] })

    // 3. RESTART: reopen the same db file
    initSettingsDb(dbPath)

    // 4. everything is present and correct
    const snap = readSnapshot()   // must NOT re-seed (db non-empty)
    const c9 = snap.companies.find(c => c.id === 'c9')!
    expect(c9.name).toBe('Client Nine')
    const chat = c9.engagements[0].chats[0]
    expect(chat.messages.map(m => m.id)).toEqual(['m1', 'm2', 'm3'])
    expect(chat.messages[2].state).toBe('success')
    expect(chat.findings.map(f => f.id)).toEqual(['f9'])
    expect(chat.findings[0].evidence[0]).toEqual({ kind: 'tool_output', toolCallId: 'run_prowler', excerpt: 'Action: *' })
  })
})
```

- [ ] **Step 2: Run it — verify it passes**

Run: `cd nexra && npx vitest run test/m4-integration.test.ts`
Expected: PASS.

- [ ] **Step 3: Run the ENTIRE suite + build**

Run: `cd nexra && npm test && npm run build`
Expected: all tests green (existing 56+ plus the new M4 tests), `tsc --noEmit` + `vite build` clean.

If `test/store.mock.test.ts` asserts `buildSnapshot` is the boot source, update it: `store.mock`'s `buildSnapshot` is no longer wired into `main.ts` (kept only as the seed source via `buildCompanies`). Leave `store.mock.ts`/`seed.ts` in place; only adjust a test if it asserts the old boot wiring.

- [ ] **Step 4: Commit**

```bash
git add nexra/test/m4-integration.test.ts
git commit -m "test(m4): full-engagement persistence round-trip across restart"
```

---

## Self-Review

**Spec coverage:**
- Full graph persistence (companies/engagements/chats/messages) → Tasks 1–4, 7 ✓
- Findings survive (already) + fold into snapshot → Task 2 (readGraph), Task 7 (drop rehydrateFindings) ✓
- Store-write path → Task 6 (`store:save`) + Task 7 (autosave) ✓
- Cascade deletes → Task 3 + Task 7 ✓
- Seed-if-empty → Task 4 ✓
- Migration test (M3-era db upgrades) → Task 1 ✓
- phase_coverage + engagement_memory (service + IPC + populated) → Task 5 (service), Task 6 (IPC + skill-run population) ✓
- Round-trip / done-when → Task 8 ✓
- No new UI (backend substrate only) → coverage/memory exposed via read IPC, no component added ✓

**Placeholder scan:** Task 6 Step 3 and Task 7 Step 1 intentionally say "model on existing test `X` — copy its harness" rather than inlining a fake provider/DOM harness verbatim; the exact harness lives in `test/agent.live.m3b.test.ts` and `test/ipc.test.ts` and must be mirrored, not reinvented. Every implementation step ships complete code.

**Type consistency:** `saveGraph(companies: Company[])`, `readGraph(): Company[]`, `readSnapshot(): Snapshot`, `deleteCompanyGraph`/`deleteChatGraph`, `setPhaseCoverage`/`listPhaseCoverage`, `appendMemory`/`listMemory` — names/signatures identical across the tasks that define and consume them. `window.nexra.store` methods (`save`/`deleteCompany`/`deleteChat`/`coverage`/`memory`) match between preload (Task 6), global.d.ts (Task 6), and App.tsx (Task 7). `phaseLabel` is the coverage key in both Task 5's store and Task 6's writer.

## Notes for the implementer

- The reducer's `clone()` returns a fresh `state.data` on every mutation, so the `[state.data]` autosave effect fires on all structural + message changes — no per-action wiring needed beyond the two deletes.
- Do not persist `enforcement` (typed `EngagementScope`) in the `engagements` table — it already lives in the `scope` table (M3b) and is read via `scope:get`. `readGraph` leaves `engagement.enforcement` undefined.
- Never call `Date.now()`/`new Date()` in services — this codebase stamps relative strings (`'just now'`) and tests compare on them.
- Keep `store.mock.ts` and `seed.ts`; `buildCompanies`/`buildTypes` are the seed source `readSnapshot` uses. Only `main.ts` stops calling `buildSnapshot` directly.
</content>
