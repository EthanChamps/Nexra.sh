# Remove Tools Panel Section — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Tools tab from the Context panel and all dead plumbing that fed it, leaving no orphaned code.

**Architecture:** Pure subtractive change. The "verification" for a removal is the type-checker (`tsc` via `npm run build`) plus the existing test suite — after edits, both must be green with zero remaining references to the removed symbols. Work top-down: renderer UI → reducer/ipc → shared types/seed → SQLite persistence → test fixtures.

**Tech Stack:** Electron + React/Vite + TypeScript, `better-sqlite3`, vitest.

## Global Constraints

- No renderer component imports a service directly — all cross-boundary access stays via `window.nexra.*` (unchanged here; we only delete).
- Do NOT touch `ToolCard.tsx`, the `agent.install` IPC flow, or the real agent registry `agent.tools.ts` / `AWS_SKILLS` / `runSkill`.
- Removed symbols (must have zero references after, excluding the kept items above): `ToolAvailability`, `markToolAvailable`, `primaryTool`, `chat.tools` / `cfg.tools` / `c.tools` / `ch.tools`.
- Spec: `docs/superpowers/specs/2026-07-03-remove-tools-panel-design.md`.

---

### Task 1: Remove the Tools tab from ContextPanel

**Files:**
- Modify: `src/components/ContextPanel.tsx` (lines 17, 44–48, 67, 163–176)

- [ ] **Step 1: Remove `'tools'` from the tab-state union (line 17)**
  `useState<'scope' | 'secrets' | 'findings' | 'tools'>('scope')` → drop `| 'tools'`.

- [ ] **Step 2: Remove the `tools` derivation (lines 44–48)**
  Delete the `const tools = chat!.tools.map(...)` block entirely.

- [ ] **Step 3: Remove `'tools'` from the tab-bar array (line 67)**
  `['scope', 'secrets', 'findings', 'tools']` → `['scope', 'secrets', 'findings']`.

- [ ] **Step 4: Remove the `tab === 'tools'` render block (lines 163–176)**
  Delete the whole `{tab === 'tools' && ( ... )}` fragment.

- [ ] **Step 5: Verify types compile**
  Run: `npm run build`
  Expected: no errors referencing `tools` in `ContextPanel.tsx`. (Build may still fail elsewhere until later tasks — that's fine; confirm the ContextPanel errors are gone.)

---

### Task 2: Remove reducer plumbing (markToolAvailable + tools copies)

**Files:**
- Modify: `src/state/reducer.ts` (lines 83, 117, 127, 247–252)

- [ ] **Step 1: Remove the action from the union (line 117)**
  Delete `| { t: 'markToolAvailable'; chatId: string; toolName: string }`.

- [ ] **Step 2: Remove the `case 'markToolAvailable'` block (lines 247–252)**
  Delete the entire case.

- [ ] **Step 3: Remove `tools: [...ch.tools]` from `clone` (line 127)**
  In the per-chat map inside `clone`, drop the `tools: [...ch.tools]` property.

- [ ] **Step 4: Remove `tools` from new-chat creation (line 83)**
  Delete `, tools: cfg.tools.map(t => ({ ...t }))` from the returned new chat object.

- [ ] **Step 5: Verify**
  Run: `npm run build`
  Expected: no errors referencing `markToolAvailable` or `.tools` in `reducer.ts`.

---

### Task 3: Remove ipc.ts wiring (primaryTool + install dispatch)

**Files:**
- Modify: `src/ipc.ts` (the `installTool` success handler; lines 77, 80, 110, 113)

- [ ] **Step 1: Remove the `markToolAvailable` dispatch in `installTool`**
  In the `tool_call` success branch, delete the `dispatch({ t: 'markToolAvailable', ... })` line. Keep the rest of the install-success handling.

- [ ] **Step 2: Remove both `primaryTool` derivations (lines 77 and 110)**
  Delete `const primaryTool = chat.tools.find(t => t.available)?.name ?? 'shell'` in both send paths.

- [ ] **Step 3: Drop `primaryTool` from both request payloads (lines 80 and 113)**
  Remove `primaryTool, ` from each `AgentSendRequest` object literal.

- [ ] **Step 4: Verify**
  Run: `npm run build`
  Expected: no errors referencing `primaryTool` or `markToolAvailable` in `ipc.ts`.

---

### Task 4: Remove the shared types and seed data

**Files:**
- Modify: `electron/services/store.types.ts` (lines 6, 11, 52)
- Modify: `electron/services/seed.ts` (lines 29, 33, 37, 41, 45, 63)
- Modify: `electron/services/agent.types.ts` (line 24)

- [ ] **Step 1: Delete `ToolAvailability` (store.types.ts line 6)**
  Remove `export interface ToolAvailability { name: string; available: boolean }`.

- [ ] **Step 2: Remove `tools` from `ReviewTypeConfig` (line 11) and `Chat` (line 52)**
  Drop the `tools: ToolAvailability[]` member from both interfaces.

- [ ] **Step 3: Remove `tools: [...]` from all seeds (seed.ts)**
  Delete the `tools: [...]` array from each of the five review-type configs (29, 33, 37, 41, 45) and the example chat (63).

- [ ] **Step 4: Remove `primaryTool` from `AgentSendRequest` (agent.types.ts line 24)**
  Drop `primaryTool: string; ` from the interface. (Confirmed unused by `agent.live.ts`.)

- [ ] **Step 5: Verify**
  Run: `npm run build`
  Expected: no errors referencing `ToolAvailability`; remaining errors (if any) only in `store.graph.ts` / tests, fixed next.

---

### Task 5: Remove the SQLite `tools` column

**Files:**
- Modify: `electron/services/store.graph.ts` (lines 3, 25–28, 49, 66, 122, 133)
- Modify: `electron/services/store.sqlite.ts` (line 81)

- [ ] **Step 1: Drop the DDL column (store.sqlite.ts line 81)**
  In `CREATE TABLE IF NOT EXISTS chats (...)`, remove `tools TEXT NOT NULL,`.

- [ ] **Step 2: Remove `ToolAvailability` import (store.graph.ts line 3)**
  Drop it from the `import type { ... }` list.

- [ ] **Step 3: Remove `tools` from the INSERT (lines 25–28)**
  Remove `tools` from the column list and `@tools` from VALUES, and remove `tools=excluded.tools` from the upsert `SET` clause.

- [ ] **Step 4: Remove `tools` from the INSERT params (line 49)**
  Drop `tools: JSON.stringify(ch.tools), ` from the params object.

- [ ] **Step 5: Remove `tools` from `ChatRow` (line 66) and SELECT (line 122)**
  Drop `tools: string` from the interface and `tools` from the `SELECT ... FROM chats` column list.

- [ ] **Step 6: Remove `tools` from the row→object parse (line 133)**
  Drop `tools: JSON.parse(ch.tools) as ToolAvailability[], `.

- [ ] **Step 7: Verify**
  Run: `npm run build`
  Expected: no errors referencing `tools` in the store files.

---

### Task 6: Update test fixtures and reset the dev DB

**Files:**
- Modify: `test/agent.live.test.ts` (line 11), `test/agent.live.inputs.test.ts` (line 12), `test/agent.live.findings.test.ts` (line 13), `test/agent.live.coverage.test.ts` (line 20)
- Modify: `test/store.graph.test.ts` (line 22), `test/store.graph.delete.test.ts` (lines 16–17)

- [ ] **Step 1: Remove `primaryTool: 'prowler',` from the four agent.live.* request fixtures.**

- [ ] **Step 2: Remove `tools: [...]` / `tools: []` from the chat fixtures in `store.graph.test.ts` (line 22) and `store.graph.delete.test.ts` (lines 16–17).**

- [ ] **Step 3: Reset any local dev DB**
  Remove the local sqlite dev DB so a fresh schema is created (path is under Electron `userData`; the test suite uses temp DBs so this is only for `npm run dev`). Note the location for the user; do not delete anything outside the app's data dir.

- [ ] **Step 4: Run the full suite**
  Run: `npm test`
  Expected: all tests pass.

- [ ] **Step 5: Final orphan grep**
  Run: `grep -rn -E "ToolAvailability|markToolAvailable|primaryTool|\.tools\b|cfg\.tools" src electron test | grep -viE "toolcard|tool_call|agent\.tools|upsertTool|toolCards"`
  Expected: no output.

---

### Task 7: Full verification + commit

- [ ] **Step 1: Build**
  Run: `npm run build` — Expected: clean.

- [ ] **Step 2: Test**
  Run: `npm test` — Expected: all green.

- [ ] **Step 3: Commit**
  ```bash
  git add -A
  git commit -m "feat(ui): remove the Tools section from the Context panel"
  ```
