# Remove the Tools section from the Context panel

**Date:** 2026-07-03
**Status:** Approved (brainstorming) — ready for implementation plan

## Problem

The Context panel (right-side `<aside>` in the chat workspace) has a **Tools**
tab that renders a per-chat list of tools as green "available" / amber
"missing" rows. This tab is cosmetic and dishonest:

- The list is **static seed data** (`seed.ts`), not a reflection of anything
  real on the machine.
- The seed tool names (`prowler`, `aws-cli`, `nmap`, `bloodhound`, …) do **not**
  match the agent's real skill registry (`AWS_SKILLS`: `run_prowler`,
  `run_scoutsuite`, `run_pmapper`), and nothing probes whether any binary is
  actually installed.
- The only runtime change is `markToolAvailable`, fired when a user installs a
  tool from an in-message `ToolCard` — flipping one seeded row to "available".

Making it honest would require real system probing (a new IPC surface,
per-tool binary mapping, refresh semantics). That effort isn't wanted right
now. **Decision: remove the Tools section entirely, including its dead
plumbing.**

## Goal

Delete the Tools tab and all data-model / persistence / reducer plumbing that
existed solely to feed it, leaving **no orphaned code**. The app builds, all
tests pass, and the remaining three Context-panel tabs (Scope, Secrets,
Findings) work exactly as before.

## Non-goals

- Do **not** touch the in-message `ToolCard` (the "Tool unavailable / Install"
  cards in the message stream) or the `agent.install` IPC flow. Installing a
  missing tool still runs; it simply no longer updates a (now-removed) panel.
- Do **not** touch the real agent skill registry `agent.tools.ts` /
  `AWS_SKILLS` or `runSkill` — that is the agent's genuine tool-calling path
  and is unrelated to the panel.
- No new probing / availability feature. This is a pure removal.

## Scope of changes

### Renderer

- **`src/components/ContextPanel.tsx`**
  - Remove `'tools'` from the `tab` state union (line 17).
  - Remove `'tools'` from the tab-bar array (line 67).
  - Remove the `tools = chat!.tools.map(...)` derivation (lines 44–48).
  - Remove the entire `tab === 'tools'` render block (lines 163–176).
- **`src/state/reducer.ts`**
  - Remove the `markToolAvailable` action from the action union (line 117) and
    its `case` (lines 247–252).
  - Remove `tools: [...ch.tools]` from the `clone` deep-copy (line 127).
  - Remove `tools: cfg.tools.map(t => ({ ...t }))` from new-chat creation
    (line 83).
- **`src/ipc.ts`**
  - Remove the `markToolAvailable` dispatch on install success (in
    `installTool`).
  - Remove the `primaryTool` derivations (lines 77 and 110) and drop
    `primaryTool` from the two `AgentSendRequest` payloads (lines 80 and 113).

### Main process / types

- **`electron/services/store.types.ts`**
  - Delete the `ToolAvailability` interface (line 6).
  - Remove `tools: ToolAvailability[]` from `ReviewTypeConfig` (line 11) and
    `Chat` (line 52).
- **`electron/services/seed.ts`**
  - Remove the `tools: [...]` seed on all five review-type configs and the
    example chat (lines 29, 33, 37, 41, 45, 63).
- **`electron/services/agent.types.ts`**
  - Remove `primaryTool: string` from `AgentSendRequest` (line 24).
    **Confirmed dead:** `agent.live.ts` never reads `req.primaryTool`.
- **`electron/services/store.graph.ts`**
  - Remove the `ToolAvailability` import (line 3).
  - Remove `tools` from the chats INSERT column list + values
    (lines 25–28, 49), from the `ChatRow` interface (line 66), from the chats
    SELECT (line 122), and from the row→object parse (line 133).
- **`electron/services/store.sqlite.ts`**
  - Remove `tools TEXT NOT NULL,` from the `chats` `CREATE TABLE` (line 81).

### Persistence caveat (SQLite)

SQLite's `CREATE TABLE IF NOT EXISTS` will not alter an existing table, and the
`tools` column is `NOT NULL` with no default — so an old dev DB that still has
the column will reject the new column-less INSERT. Because this is a pre-ship
app (M4 in progress, **no production data**, dev DBs are seeded/disposable),
we remove the column from the DDL and code and **reset any local dev DB**
rather than write a table-rebuild migration for data that does not exist yet.
The plan should call out deleting the local `store.sqlite` (dev DB) as a step
so tests/`npm run dev` start from the new schema.

### Tests

- **`test/agent.live.test.ts`**, **`test/agent.live.inputs.test.ts`**,
  **`test/agent.live.findings.test.ts`**, **`test/agent.live.coverage.test.ts`**
  — remove `primaryTool: 'prowler'` from each `AgentSendRequest` fixture.
- **`test/store.graph.test.ts`** (line 22) and **`test/store.graph.delete.test.ts`**
  (lines 16–17) — remove `tools: [...]` / `tools: []` from chat fixtures.
- **`test/store.graph.schema.test.ts`** — no change needed; it asserts table
  *names*, not columns.
- Grep the whole tree once more for `ToolAvailability`, `markToolAvailable`,
  `primaryTool`, `\.tools`, and `cfg.tools` after edits to confirm nothing is
  orphaned (excluding `ToolCard` / `tool_call` / the `agent.tools.ts`
  registry, which stay).

## Verification / success criteria

1. `npm run build` (tsc + vite) passes — no type errors from the removed
   `ToolAvailability` / `primaryTool`.
2. `npm test` passes (updated fixtures; schema/snapshot tests green against the
   new chats schema on a fresh DB).
3. Manual: launch the app, open a chat — the Context panel shows only Scope,
   Secrets, and Findings tabs; no Tools tab; no console errors; the in-message
   Install flow on a `ToolCard` still runs.
4. Final grep confirms zero remaining references to the removed symbols.

## Risks

- **Low.** This is a subtractive change with a small, fully-enumerated call-site
  set. The only non-obvious edge is the SQLite column (handled above by DB
  reset). `primaryTool` is verified unused by the agent, so dropping it changes
  no behavior.
