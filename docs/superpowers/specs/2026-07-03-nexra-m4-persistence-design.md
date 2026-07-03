# Nexra.sh — M4: Persistence + external memory (design)

**Date:** 2026-07-03
**Status:** Approved (autonomous — see "Decisions & assumptions")
**Milestone:** M4 (Phase 2 of `2026-07-02-nexra-internal-usable-plan.md`)
**Backend touched:** `StoreService` (the last mock backend)

## Goal

On restart, a complete engagement survives: companies → engagements → chats →
messages → findings all reload from disk exactly as they were. Today only
settings, secrets, scope, and findings persist; the companies/engagements/
chats/messages graph lives only in the renderer's `useReducer` state and the
one-time seed snapshot, so **everything structural is lost on quit**.

Additionally, stand up the **external-memory** and **phase-coverage**
substrate (competitive Req 2b/2c) as a queryable structure — designed and
wired at the storage layer now, so the AWS vertical and later pentest
verticals can build planning/context-bounding on top without a schema rewrite.

**Done when:**
- Create a company, an engagement, several chats, hold real conversations,
  log findings → quit → relaunch → the entire graph is present and correct.
- Renaming/recoloring/deleting a company/engagement/chat persists.
- A schema-migration test proves an older DB (M3-era: settings/secrets/scope/
  findings only) loads into the M4 schema without data loss.
- `phase_coverage` and `engagement_memory` exist with service functions, IPC,
  and tests, populated from the existing agent event stream where natural.
- `npm test` green, `tsc --noEmit` + `npm run build` clean.

## Current state (verified 2026-07-03)

| Data | Persists today? | How |
|---|---|---|
| settings (provider/model/key) | yes | `settings` table (M3a) |
| secrets (meta + encrypted values) | yes | `secrets`/`secret_values` (M3b) |
| engagement scope | yes | `scope` (M3b) |
| findings + evidence | yes | `findings`/`evidence` (M3c); main persists via `upsertFinding` in `agent.live.ts:90`, renderer rehydrates via `findings:list` |
| **companies/engagements/chats/messages** | **no** | renderer `useReducer` only; `store:snapshot` returns the mock seed (`store.mock.ts` → `seed.ts`) |

**How data flows today (the seam we extend):**
- Boot: `App.tsx` calls `getSnapshot()` → `store:snapshot` IPC → `buildSnapshot()` (seed) → `dispatch({t:'hydrate'})`, then `rehydrateFindings()` pulls findings from sqlite per chat.
- Every message passes through main: user text arrives as an `agent:send` request (`main.ts:69`); assistant/tool/skill/request content is emitted by main as `agent:event:<chatId>` events (`agent.live.ts`); the chat title arrives via `agent:title` (`main.ts:77`). The renderer's `applyEvent` (`src/ipc.ts`) translates events into reducer actions.
- Structural mutations (create/rename/recolor/delete company/engagement/chat) are **pure renderer reducer actions with no IPC** (`reducer.ts:107–182`) — main never sees them.

## Architecture

Ownership split by **who originates the data**, so each row is written once by
the layer that already produces it. Two writers only:

- **Renderer autosave** owns the *structure + transcript*: companies,
  engagements, chats, messages. One debounced code path, no per-action wiring.
- **Main** owns *event-originated* data it already emits at event time:
  findings/evidence (already working), plus new `phase_coverage` and
  `engagement_memory`. Settings/secrets/scope stay main-owned (M3a/b).

This avoids the two hard problems of the alternatives: no per-token writes, and
main never has to reconstruct the renderer's message segmentation.

### 1. Renderer autosave → structure + messages (one path)

The reducer's `clone()` produces a fresh `state.data` reference on every
mutation, so a single effect covers **every** structural and message change:

```ts
// App.tsx — debounced autosave, guarded until first hydration completes
useEffect(() => {
  if (!hydrated) return
  const id = setTimeout(() => window.nexra.store.save(state.data.companies), 400)
  return () => clearTimeout(id)
}, [state.data, hydrated])
```

- `store.save(companies)` upserts every company/engagement/chat/message **by
  `id`** (`INSERT … ON CONFLICT(id) DO UPDATE`) in a **single transaction**.
  Idempotent; safe to run repeatedly.
- Debounce (400 ms) coalesces a streaming turn's many rapid dispatches into a
  couple of saves plus a final one — **not** a write per token.
- Message `id`s are the renderer's own `nextId('m')` values; they persist and
  reload verbatim, so in-session and reloaded IDs are identical (no dual-ID
  problem). Autosave **does not** touch findings/evidence rows — those stay
  main-owned.
- The write cost per save is O(entities), a few-hundred-row upsert in one
  transaction (~1–2 ms) — the "doesn't degrade as the transcript grows"
  criterion is about the *agent's* context, not sqlite write time, which stays
  flat here.

### 2. Deletes → explicit cascade IPC (write-through)

Autosave only upserts, so removals need an explicit signal. The UI has exactly
two delete actions (no engagement-delete exists); wire each write-through from
a thin dispatch wrapper in `App.tsx` (reducer stays pure):

| Reducer action | IPC | Cascade |
|---|---|---|
| `confirmDeleteCompany` (id from `ui.confirmDeleteCompanyId`) | `store:company:delete` | engagements → chats → messages → findings/evidence |
| `ctxDelete` (`a.chatId`) | `store:chat:delete` | messages → findings/evidence |

Messages are only ever appended/updated in-place, never individually removed,
so no per-message delete is needed. Pure UI-state actions (view, active-chat
map, ctx menus, terminal, settings, streaming flags) are never persisted.

### 3. Boot → read the full graph from sqlite

`store:snapshot` changes from "return the seed" to:
1. Read the full graph (companies→engagements→chats→messages, with each chat's findings folded in from the `findings` table) from sqlite.
2. If the DB has **no companies** (fresh install / dev), write the seed into sqlite once via `store.save`, then return it. Seed becomes a one-time initializer, not a per-boot source.
3. Return the hydrated snapshot. Because findings are folded in, `rehydrateFindings` becomes redundant — remove it and its per-chat round-trips from `App.tsx`/`ipc.ts`.

### 4. External memory + phase coverage (substrate only)

New queryable tables + service functions + IPC, **no new UI** (the design
reference has no element for them; per CLAUDE.md's icon/decoration rule we do
not invent one). Populated from the existing event stream where natural:

- `phase_coverage(engagement_id, phase_id, status, updated)` — `status ∈ {pending, in_progress, done}`. Written when a skill run targets a phase (from the M3b skill event) and when a phase's findings settle. Read IPC for later consumers.
- `engagement_memory(id, engagement_id, chat_id, kind, content, time)` — `kind ∈ {target, dead_end, note}`. Append + query IPC. Populated from agent-surfaced targets/dead-ends as those events exist; the table + API are the deliverable now.

> Scope note: M4 delivers the *storage substrate*. The agent *using* memory to
> bound its context (so a long phase doesn't degrade as its transcript grows)
> is a follow-on in the agent loop, not M4. M4 persists full transcripts.

## Schema (additive migration)

All `CREATE TABLE IF NOT EXISTS` in `initSettingsDb` (one migration path). New
tables only; existing tables untouched, so an M3-era DB upgrades in place.

```sql
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, updated TEXT NOT NULL, ord INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS engagements (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL,
  status TEXT NOT NULL, updated TEXT NOT NULL, linear INTEGER NOT NULL,
  phases TEXT NOT NULL,   -- JSON Phase[]
  scope TEXT NOT NULL,    -- JSON ScopeRow[] (display rows; enforced scope stays in `scope` table)
  ord INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY, engagement_id TEXT NOT NULL, name TEXT NOT NULL,
  phase_id TEXT NOT NULL, color TEXT NOT NULL,
  tools TEXT NOT NULL,    -- JSON ToolAvailability[]
  ord INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, role TEXT NOT NULL, kind TEXT NOT NULL,
  content TEXT, tool_name TEXT, command TEXT, output TEXT, duration TEXT,
  reason TEXT, install_cmd TEXT, state TEXT,
  request_kind TEXT, request_id TEXT, items TEXT, engagement_id TEXT,  -- request cards (M3d)
  ord INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS phase_coverage (
  engagement_id TEXT NOT NULL, phase_id TEXT NOT NULL, status TEXT NOT NULL, updated TEXT NOT NULL,
  PRIMARY KEY (engagement_id, phase_id)
);
CREATE TABLE IF NOT EXISTS engagement_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT, engagement_id TEXT NOT NULL, chat_id TEXT,
  kind TEXT NOT NULL, content TEXT NOT NULL, time TEXT NOT NULL
);
```

`ord` columns preserve insertion order deterministically (sqlite `rowid` would
also work, but an explicit `ord` survives re-inserts and makes ordering intent
obvious). Messages order within a chat by `ord`; findings keep their existing
`rowid` ordering.

## Module structure

`store.sqlite.ts` already does settings + secrets + scope + findings; adding
the graph would make it too large. Refactor minimally:

- `store.sqlite.ts` — export a shared `getDb()` accessor; keep `initSettingsDb`
  as the single schema owner (add the new `CREATE TABLE`s here); keep settings/
  secrets/scope/findings functions where they are (no behavior change).
- **new `store.graph.ts`** — companies/engagements/chats/messages CRUD + snapshot
  read + seed-if-empty, plus `phase_coverage` and `engagement_memory` functions.
  Uses `getDb()`. Row↔type mappers mirror the existing `rowToSecret`/`rowToFinding` style.

IPC additions in `main.ts` — `store:save`, `store:company:delete`,
`store:chat:delete`, a rewritten `store:snapshot`, and read/write channels for
`phase_coverage`/`engagement_memory` — with matching `window.nexra.store.*`
methods in `preload.ts`. Coverage/memory writes are called from `agent.live.ts`
where the skill/finding events already fire.

## Error handling

- Persistence failures **must not crash the UI or lose the live session**. A
  failed write logs (main-process console) and returns `{success:false}` where
  a result is expected; the renderer already holds the state in memory, so the
  session continues — only durability for that one write is at risk. (Matches
  the existing `secrets:fulfill-pending` try/catch shape.)
- All multi-row writes (delete-cascade, seed-insert, snapshot upsert) run in a
  `better-sqlite3` transaction so a partial failure rolls back.
- Cascade deletes are explicit `DELETE` statements in a transaction (consistent
  with `deleteSecretRow`'s manual child-delete style) rather than relying on FK
  `ON DELETE CASCADE`, since the existing tables don't declare FKs.

## Testing

Following the existing `*.test.ts` conventions (Vitest, real better-sqlite3 on
a temp DB path — the codebase already tests sqlite against real files):

- **Save/read round-trip**: `store.save` a companies graph (with nested engagements/chats/messages), reopen the DB, `readGraph` returns an equal graph; findings folded in from the `findings` table.
- **Upsert idempotence**: saving twice (e.g. a message edited in place, a renamed chat) updates rows rather than duplicating; a shrunk chat keeps only current messages? — messages are never removed in-app, so assert re-save updates existing message rows by id and adds new ones, no dups.
- **Cascade delete**: `deleteCompany` removes its engagements/chats/messages/findings/evidence; `deleteChat` removes its messages/findings/evidence; siblings untouched.
- **Seed-if-empty**: fresh DB gets the seed exactly once; a non-empty DB is never re-seeded.
- **Migration**: build an M3-era DB (settings+secrets+scope+findings only, no graph tables), run `initSettingsDb`, assert the new tables are created and the old data still reads.
- **phase_coverage / engagement_memory**: write/read/query round-trips.
- **Renderer autosave** (mocked `window.nexra`, as existing renderer tests do): a dispatched structural mutation eventually calls `store.save` with the updated graph; `confirmDeleteCompany`/`ctxDelete` call the matching delete channel with the right id.

## Decisions & assumptions (autonomous)

Made without blocking (background job; user delegated brainstorm→implement).
All reversible:

1. **External memory + phase coverage = backend substrate only, no new UI.** The design reference has no element for them; per CLAUDE.md, don't invent decorative UI. Tables + service + IPC + tests are the deliverable.
2. **Seed-on-empty-DB retained** as a first-run/dev convenience (matches the internal-usable plan's "keep the seed for first-run/dev only").
3. **Full transcripts persisted**; agent context-bounding via memory is a follow-on, not M4.
4. **Renderer debounced autosave for structure + transcript; main owns event-originated data** (findings/coverage/memory), rather than routing every message through granular per-action IPC. Autosave is one code path, avoids per-token writes, and needs no message-segmentation logic in main; explicit delete IPC covers the only two removals in the UI. This was chosen over granular write-through IPC (more channels, more places to get subtly wrong) for a local single-user tool where a few-ms full-graph upsert is free.

## Out of scope (deferred)

- Any new UI for memory/coverage (deferred until a vertical consumes it).
- Agent context-bounding / transcript summarization (agent-loop work).
- Multi-user / shared / synced data (explicitly de-scoped for internal v1).
- Report export (Phase 5) and hardening/packaging (Phase 6) — later milestones.

## Where things live

- This spec: `docs/superpowers/specs/2026-07-03-nexra-m4-persistence-design.md`
- Plan: `docs/superpowers/plans/2026-07-03-nexra-m4-persistence.md` (next)
- Prior roadmap: `docs/superpowers/specs/2026-07-02-nexra-internal-usable-plan.md`
- Touched code: `nexra/electron/services/store.sqlite.ts` (+`store.graph.ts` new),
  `nexra/electron/services/agent.live.ts`, `nexra/electron/main.ts`,
  `nexra/electron/preload.ts`, `nexra/src/App.tsx`, `nexra/src/ipc.ts`
</content>
</invoke>
