# Instant New-Chat Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking **+ New Chat** instantly creates a chat under the engagement (no picker modal); the chat is titled and focus-inferred from the user's first message.

**Architecture:** New chats are created provisional (`name: 'New chat'`, empty `phaseId`, neutral colour) directly by the `createChat` reducer action. On the first user message, pure helpers `deriveTitle` / `inferFocus` set the name and phase — an M1 deterministic stand-in for the M2 cheapest-model title call. The `NewChatModal` and all `newChat*` UI state/actions are removed. Focus chips in three views hide until focus is inferred.

**Tech Stack:** React + TypeScript (Vite), Vitest reducer tests. Working dir for all commands: `redcell/`.

## Global Constraints

- Working directory for all commands: `redcell/` (the app root inside the repo).
- Test runner: `npm test` (`vitest run`); type/build check: `npm run build` (`tsc -p tsconfig.node.json && vite build`).
- Baseline before starting: existing test suite passes (20 tests). Keep it green after every task.
- No `Date.now()` / `Math.random()` in reducer logic — helpers must be pure and deterministic.
- Neutral default chat colour is exactly `#0a0b0d`.
- Provisional chat name is exactly the string `New chat` (used as the "not yet titled / not renamed" sentinel).
- Fidelity: styling source of truth is `redcell/design-reference/Redcell.dc.html`. This change only removes UI and hides chips; do not alter retained surfaces' hex/px values.

---

### Task 1: Instant `createChat` + provisional `makeChat`

**Files:**
- Modify: `redcell/src/state/reducer.ts` (`makeChat` ~27–34; `createChat` case ~107–112; `Action` union line 44)
- Test: `redcell/test/reducer.test.ts` (rewrite the existing "creates a chat…" test ~24–33)

**Interfaces:**
- Consumes: `engagementById`, `activeEngagement` (already imported in reducer).
- Produces:
  - `makeChat(state: AppState, engId: string): Chat` — returns a provisional chat: `name: 'New chat'`, `phaseId: ''`, `color: '#0a0b0d'`, one generic assistant greeting, tools from the engagement type config.
  - Action `{ t: 'createChat'; engId?: string }` — resolves engagement from `engId` or active, sets it active, prepends the new chat, selects it.

- [ ] **Step 1: Rewrite the existing reducer test to expect a provisional chat**

In `redcell/test/reducer.test.ts`, replace the test currently at lines ~24–33 (the one using `openNewChat` / `setNewChatFocus`) with:

```ts
  it('creates a provisional chat, makes it active, seeds a greeting', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const engId = activeEngagement(s)!.id
    s = reducer(s, { t: 'createChat', engId })
    const chat = activeChat(s)!
    expect(chat.name).toBe('New chat')
    expect(chat.phaseId).toBe('')
    expect(chat.color).toBe('#0a0b0d')
    expect(chat.messages[0].role).toBe('assistant')
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd redcell && npm test -- -t "creates a provisional chat"`
Expected: FAIL — current `createChat` reads `newChatFocus`/`newChatName` and produces a phase-named chat, so `chat.name` is not `'New chat'` and `chat.phaseId` is not `''`.

- [ ] **Step 3: Rewrite `makeChat` to produce a provisional chat with a generic greeting**

Replace the whole `makeChat` function (lines ~27–34) with:

```ts
function makeChat(state: AppState, engId: string): Chat {
  const eng = engagementById(state, engId)!
  const cfg = state.data.types[eng.type]
  const greeting: Message = { id: nextId('m'), role: 'assistant', kind: 'text',
    content: "I'm the agent for this " + cfg.label + ". Ask me to enumerate configuration, run automated checks, or log findings — this chat keeps its own context." }
  return { id: nextId('ch'), name: 'New chat', phaseId: '', color: '#0a0b0d', messages: [greeting], findings: [], tools: cfg.tools.map(t => ({ ...t })) }
}
```

- [ ] **Step 4: Make `createChat` create instantly and accept `engId`**

In the `Action` union, change the `createChat` member (currently on line 44) to:

```ts
  | { t: 'createChat'; engId?: string }
```

Replace the `createChat` case (lines ~107–112) with:

```ts
    case 'createChat': {
      const id = a.engId || U.activeEngagementId; const eng = id ? engagementById(s, id) : null; if (!eng) return state
      U.activeEngagementId = eng.id
      const chat = makeChat(s, eng.id)
      eng.chats = [chat, ...eng.chats]; eng.updated = 'just now'
      U.activeChatByEngagement[eng.id] = chat.id; U.editingName = false; return s
    }
```

> Note: `openNewChat` / `setNewChat*` / `closeNewChat` and the modal state still exist after this task — they are removed in Task 3. `createChat` no longer reads them, so the app still compiles and behaves.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd redcell && npm test -- -t "creates a provisional chat"`
Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run: `cd redcell && npm test`
Expected: all tests PASS (the rewritten test replaces the old one; no other test referenced `newChat*`).

- [ ] **Step 7: Commit**

```bash
git add redcell/src/state/reducer.ts redcell/test/reducer.test.ts
git commit -m "feat: create chats instantly as provisional (no modal input)"
```

---

### Task 2: First-message titling + focus inference

**Files:**
- Modify: `redcell/src/state/reducer.ts` (add helpers near top; add `engagementForChat` helper; extend `appendUserMessage` case ~133–137)
- Test: `redcell/test/reducer.test.ts` (add new tests)

**Interfaces:**
- Consumes: `Chat`, `Message` types; `Phase` type from `../../electron/services/store.types`; the provisional-chat contract from Task 1 (`name === 'New chat'` sentinel).
- Produces (exported from `reducer.ts`):
  - `deriveTitle(text: string): string` — first ~6 words, punctuation-trimmed, capped 48 chars, first letter upper; `'New chat'` when no usable words.
  - `inferFocus(text: string, phases: Phase[]): string` — id of the first phase whose leading keyword appears in `text` (case-insensitive); else `phases[0]?.id ?? ''`.
  - Behaviour: first user message on a provisional chat sets `name = deriveTitle(text)` and `phaseId = inferFocus(text, eng.phases)`. Renamed chats and subsequent messages are untouched.

- [ ] **Step 1: Write failing helper + behaviour tests**

Add to the top of `redcell/test/reducer.test.ts` imports:

```ts
import { reducer, initialUI, deriveTitle, inferFocus } from '../src/state/reducer'
```

(Replace the existing `import { reducer, initialUI } from '../src/state/reducer'` line with the above.)

Add these tests inside the `describe('reducer', …)` block:

```ts
  it('deriveTitle takes the first six words, capitalized', () => {
    expect(deriveTitle('check conditional access policies in entra now')).toBe('Check conditional access policies in entra')
  })
  it('deriveTitle falls back to "New chat" for empty/punctuation input', () => {
    expect(deriveTitle('   ')).toBe('New chat')
    expect(deriveTitle('!!!')).toBe('New chat')
  })
  it('inferFocus matches a phase by its leading keyword, else first phase', () => {
    const phases = [{ id: 'iam', label: 'IAM' }, { id: 'storage', label: 'Storage (S3)' }]
    expect(inferFocus('audit storage buckets', phases)).toBe('storage')
    expect(inferFocus('unrelated question', phases)).toBe('iam')
  })
  it('titles a provisional chat and infers focus from the first message', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const engId = activeEngagement(s)!.id
    s = reducer(s, { t: 'createChat', engId })
    const chatId = activeChat(s)!.id
    s = reducer(s, { t: 'appendUserMessage', chatId, text: 'review iam roles for privilege escalation' })
    const chat = chatByGlobalId(s, chatId)!
    expect(chat.name).toBe('Review iam roles for privilege escalation')
    expect(chat.phaseId).toBe('iam')
  })
  it('does not retitle a chat the user already renamed', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const engId = activeEngagement(s)!.id
    s = reducer(s, { t: 'createChat', engId })
    const chatId = activeChat(s)!.id
    s = reducer(s, { t: 'startRename' })
    s = reducer(s, { t: 'setNameDraft', value: 'My audit' })
    s = reducer(s, { t: 'saveName' })
    s = reducer(s, { t: 'appendUserMessage', chatId, text: 'look at storage buckets' })
    expect(chatByGlobalId(s, chatId)!.name).toBe('My audit')
  })
  it('only titles on the first user message', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const engId = activeEngagement(s)!.id
    s = reducer(s, { t: 'createChat', engId })
    const chatId = activeChat(s)!.id
    s = reducer(s, { t: 'appendUserMessage', chatId, text: 'enumerate iam users' })
    const first = chatByGlobalId(s, chatId)!.name
    s = reducer(s, { t: 'appendUserMessage', chatId, text: 'now check storage encryption' })
    expect(chatByGlobalId(s, chatId)!.name).toBe(first)
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd redcell && npm test -- -t "deriveTitle"`
Expected: FAIL — `deriveTitle`/`inferFocus` are not exported yet (import error / undefined).

- [ ] **Step 3: Add the pure helpers**

In `redcell/src/state/reducer.ts`, add near the top (after the `nextId` definition, ~line 8). Add `Phase` to the type import from `store.types` on line 4 so it reads:

```ts
import type { Chat, Message, Finding, Phase } from '../../electron/services/store.types'
```

Then add the helpers:

```ts
// M1 stand-in for the M2 cheapest-model auto-title call: derive a short title
// from the user's first question. Pure/deterministic (no clock, no randomness).
export function deriveTitle(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean).slice(0, 6)
  const cleaned = words.join(' ').replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '').slice(0, 48).trim()
  if (!cleaned) return 'New chat'
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

// M1 stand-in for M2 context focus inference: pick the phase whose leading
// keyword appears in the first message; fall back to the first phase.
export function inferFocus(text: string, phases: Phase[]): string {
  const lower = text.toLowerCase()
  const match = phases.find(p => {
    const key = p.label.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)[0]
    return key ? lower.includes(key) : false
  })
  return (match || phases[0])?.id ?? ''
}
```

- [ ] **Step 4: Add an `engagementForChat` helper**

In `redcell/src/state/reducer.ts`, add this helper (place it near `makeChat`, before the reducer function):

```ts
function engagementForChat(state: AppState, chatId: string) {
  for (const c of state.data.companies)
    for (const e of c.engagements)
      if (e.chats.some(ch => ch.id === chatId)) return e
  return null
}
```

- [ ] **Step 5: Hook titling/focus into `appendUserMessage`**

Replace the `appendUserMessage` case (lines ~133–137) with:

```ts
    case 'appendUserMessage': {
      const c = chatByGlobalId(s, a.chatId); if (!c) return state
      const firstUser = !c.messages.some(m => m.role === 'user')
      c.messages.push({ id: nextId('m'), role: 'user', kind: 'text', content: a.text })
      // First question on a still-provisional chat → title + infer focus.
      // Never overrides a chat the user already renamed.
      if (firstUser && c.name === 'New chat') {
        const eng = engagementForChat(s, a.chatId)
        c.name = deriveTitle(a.text)
        if (eng) c.phaseId = inferFocus(a.text, eng.phases)
      }
      return s
    }
```

- [ ] **Step 6: Run the new tests, then the full suite**

Run: `cd redcell && npm test -- -t "deriveTitle" && npm test`
Expected: the targeted tests PASS; full suite PASS.

- [ ] **Step 7: Commit**

```bash
git add redcell/src/state/reducer.ts redcell/test/reducer.test.ts
git commit -m "feat: title chat and infer focus from first message (M1 mock)"
```

---

### Task 3: Wire triggers to `createChat`, delete the modal and dead state

**Files:**
- Delete: `redcell/src/components/modals/NewChatModal.tsx`
- Modify: `redcell/src/screens/Workspace.tsx` (import line 9; `openNewChat` line 27; button `onClick` line 64; render line 79)
- Modify: `redcell/src/components/Sidebar.tsx` (`openNewChat` line 46; button `onClick` line 148)
- Modify: `redcell/src/state/types.ts` (line 14 — remove `newChat*` fields)
- Modify: `redcell/src/state/reducer.ts` (initial state line 14; `Action` union line 44; cases `openNewChat`/`closeNewChat`/`setNewChat*` lines ~99–106)

**Interfaces:**
- Consumes: `createChat` action from Task 1.
- Produces: no `NewChatModal`, no `newChatOpen`/`newChatName`/`newChatFocus`/`newChatColor` state, no `openNewChat`/`closeNewChat`/`setNewChatName`/`setNewChatFocus`/`setNewChatColor` actions. `+ New Chat` triggers dispatch `createChat` directly.

- [ ] **Step 1: Repoint the Workspace trigger and drop the modal render**

In `redcell/src/screens/Workspace.tsx`:
- Remove the import on line 9: `import { NewChatModal } from '../components/modals/NewChatModal'`
- Change line 27 from `const openNewChat = () => dispatch({ t: 'openNewChat' })` to:

```ts
  const openNewChat = () => dispatch({ t: 'createChat' })
```

- Remove the modal render line (line ~79): `{state.ui.newChatOpen && <NewChatModal state={state} dispatch={dispatch} />}`

(The button `onClick={openNewChat}` on line 64 stays as-is — it now creates directly.)

- [ ] **Step 2: Repoint the Sidebar trigger**

In `redcell/src/components/Sidebar.tsx`, change line 46 from `const openNewChat = (engId: string) => dispatch({ t: 'openNewChat', engId })` to:

```ts
  const openNewChat = (engId: string) => dispatch({ t: 'createChat', engId })
```

(The button `onClick={() => openNewChat(p.id)}` on line 148 stays as-is.)

- [ ] **Step 3: Delete the modal component**

```bash
git rm redcell/src/components/modals/NewChatModal.tsx
```

- [ ] **Step 4: Remove `newChat*` UI state fields**

In `redcell/src/state/types.ts` line 14, remove `newChatOpen`, `newChatName`, `newChatFocus`, `newChatColor` from the `UIState` interface. (Delete exactly those four fields; leave the rest of the line intact.)

In `redcell/src/state/reducer.ts`, in the `initialUI` object (line ~14), remove:

```ts
  newChatOpen: false, newChatName: '', newChatFocus: '', newChatColor: '#0a0b0d',
```

- [ ] **Step 5: Remove the dead actions**

In `redcell/src/state/reducer.ts`, in the `Action` union (line 44), delete the members `openNewChat`, `closeNewChat`, `setNewChatName`, `setNewChatFocus`, `setNewChatColor` (leave `createChat` from Task 1). The line becomes:

```ts
  | { t: 'createChat'; engId?: string }
```

Delete the reducer cases `openNewChat` (lines ~99–102), `closeNewChat` (~103), `setNewChatName` (~104), `setNewChatFocus` (~105), `setNewChatColor` (~106).

- [ ] **Step 6: Type-check / build and run tests**

Run: `cd redcell && npm run build && npm test`
Expected: build succeeds (no dangling references to `NewChatModal` or `newChat*`); all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: remove NewChatModal and newChat picker state"
```

---

### Task 4: Hide focus chips until focus is inferred

**Files:**
- Modify: `redcell/src/components/ChatPane.tsx` (placeholder line 34; focus chip line 75)
- Modify: `redcell/src/components/Sidebar.tsx` (focus span line 138)
- Modify: `redcell/src/components/ContextPanel.tsx` (header line 47)

**Interfaces:**
- Consumes: `chat.phaseId` may now be `''` (from Tasks 1–2); `phaseLabel` returns `''` for empty/unknown ids.
- Produces: focus chip hidden and phase-free placeholder while `phaseId` is empty; chip/label reappears once focus is inferred.

- [ ] **Step 1: ChatPane — hide the chip and drop the phase from the placeholder**

In `redcell/src/components/ChatPane.tsx`:
- Change line 34 from `const composerPlaceholder = 'Message the ' + chatFocusLabel + ' agent…'` to:

```ts
  const composerPlaceholder = chatFocusLabel ? 'Message the ' + chatFocusLabel + ' agent…' : 'Message the agent…'
```

- Wrap the focus-chip span (line 75) so it only renders when there is a label. Replace line 75 with:

```tsx
                {chatFocusLabel && <span style={{ flex: 'none', fontSize: 10, fontWeight: 500, letterSpacing: '0.04em', color: theme.accentSoft, background: 'rgba(111,123,240,0.14)', border: '1px solid rgba(111,123,240,0.24)', padding: '2px 9px', borderRadius: 20 }}>{chatFocusLabel}</span>}
```

- [ ] **Step 2: Sidebar — hide the per-chat focus label when empty**

In `redcell/src/components/Sidebar.tsx`, replace line 138 (`<span …>{ch.focusLabel}</span>`) with:

```tsx
                      {ch.focusLabel && <span style={{ fontSize: 10, color: '#565c65' }}>{ch.focusLabel}</span>}
```

- [ ] **Step 3: ContextPanel — drop the "· focus" suffix when empty**

In `redcell/src/components/ContextPanel.tsx`, replace line 47 (`<div …>CONTEXT · {chatFocusLabel}</div>`) with:

```tsx
        <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', color: theme.textDim }}>{chatFocusLabel ? 'CONTEXT · ' + chatFocusLabel : 'CONTEXT'}</div>
```

- [ ] **Step 4: Build and run tests**

Run: `cd redcell && npm run build && npm test`
Expected: build succeeds; all tests PASS.

- [ ] **Step 5: Manual smoke (optional but recommended)**

Run: `cd redcell && npm run dev`, open a company, click **+ New Chat**. Expected: a chat named "New chat" appears immediately and is selected, no modal, no focus chip in header/sidebar/context panel, composer says "Message the agent…". Send a message like "review iam roles" → chat retitles and an `IAM` focus chip appears.

- [ ] **Step 6: Commit**

```bash
git add redcell/src/components/ChatPane.tsx redcell/src/components/Sidebar.tsx redcell/src/components/ContextPanel.tsx
git commit -m "feat: hide focus chips until focus is inferred"
```

---

## Self-Review

**Spec coverage:**
- Remove modal + dead state → Task 3. ✓
- `createChat` direct with `engId` → Task 1. ✓
- `makeChat` defaults + generic greeting → Task 1. ✓
- Mock titling + focus inference on first message, renamed-guard, first-message-only → Task 2. ✓
- Graceful-empty UI in ChatPane / Sidebar / ContextPanel; `ipc.ts` already tolerant of `''` (no change) → Task 4. ✓
- Testing (createChat both paths, titling, renamed-guard, second-message, helper units) → Tasks 1–2. ✓
- M2 seam documented in code comments → Task 2 helper comments. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `deriveTitle(text: string): string`, `inferFocus(text: string, phases: Phase[]): string`, `makeChat(state, engId)`, `{ t: 'createChat'; engId?: string }`, `engagementForChat(state, chatId)` — used identically across tasks. `Phase` imported in Task 2. `'New chat'` sentinel consistent between Task 1 (set) and Task 2 (guard). ✓
