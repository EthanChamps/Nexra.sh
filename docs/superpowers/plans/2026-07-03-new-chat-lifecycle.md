# New-Chat Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Creating an engagement drops the user straight into a live chat; a
newly created chat is never persisted until it has a draft or a sent message
(so an abandoned empty chat just vanishes instead of lingering forever); and
each chat gets its own independent composer draft instead of one global field.

**Architecture:** Introduce a client-only "pending chat" concept
(`UIState.pendingChatByEngagement`) that is never written into `eng.chats`.
"+ New chat" and creating an engagement both start a pending chat. A single
reducer wrapper detects whenever the user leaves an active pending chat
(switching chats, engagements, projects, or going Home) and either commits it
into a real, persisted `Chat` (if it has a non-blank draft) or discards it (if
blank — nothing was ever persisted, so there's nothing to clean up). Sending a
message promotes a pending chat immediately and unconditionally, since it
can't wait for a "leave" that hasn't happened yet.

**Tech Stack:** React 18 + TypeScript, `useReducer` (no external state
library), Vitest + Testing Library, Electron/`contextBridge` (untouched by
this plan — no new IPC).

## Global Constraints

- Drafts are **in-memory only** (`UIState`) — no sqlite schema change, no new
  IPC method. This matches current behavior (today's global `draft` field
  isn't persisted either).
- Cleanup/commit is triggered by **in-app navigation only** — never by app
  quit/close.
- No change to `deleteChat` (`store:deleteChat` IPC) — it remains the
  explicit, user-triggered path for removing a real chat via the context menu.
- Full design context: `docs/superpowers/specs/2026-07-03-new-chat-lifecycle-design.md`.

---

### Task 1: State model — pending chat + per-chat draft, selector plumbing

**Files:**
- Modify: `nexra/src/state/types.ts`
- Modify: `nexra/src/state/reducer.ts:58-69` (only `initialUI` in this task)
- Modify: `nexra/src/state/selectors.ts`
- Test: `nexra/test/selectors.test.ts` (new file)

**Interfaces:**
- Produces: `PendingChat { id: string; draft: string }` (in `types.ts`);
  `UIState.pendingChatByEngagement: Record<string, PendingChat>`;
  `UIState.draftByChatId: Record<string, string>`; `UIState.draft` **removed**.
- Produces: `greetingFor(s: AppState, eng: Engagement): string`,
  `activeChat(s: AppState): Chat | null` (now resolves a pending chat too),
  `getDraft(s: AppState): string` — all in `selectors.ts`.
- Consumed by: Task 2 (`greetingFor`, `PendingChat`), Task 3 (`getDraft`).

This task is purely additive/safe: nothing yet populates
`pendingChatByEngagement`, so existing behavior is unchanged. It compiles and
keeps the full suite green.

- [ ] **Step 1: Write the failing selector tests**

Create `nexra/test/selectors.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { activeChat, getDraft, greetingFor } from '../src/state/selectors'
import { buildSnapshot } from '../electron/services/store.mock'
import { initialUI } from '../src/state/reducer'
import type { AppState } from '../src/state/selectors'

const boot = (): AppState => ({ data: buildSnapshot(), ui: initialUI })

describe('activeChat — pending chat resolution', () => {
  it('returns null when no chat (real or pending) is active for the engagement', () => {
    const s = boot()
    expect(activeChat(s)).toBeNull()
  })

  it('synthesizes a view-model chat for a pending (not-yet-persisted) chat', () => {
    const s = boot()
    const eng = s.data.companies[0].engagements[0]
    const ui = {
      ...s.ui,
      activeCompanyId: s.data.companies[0].id,
      activeEngagementId: eng.id,
      activeChatByEngagement: { [eng.id]: 'ch-pending-1' },
      pendingChatByEngagement: { [eng.id]: { id: 'ch-pending-1', draft: '' } },
    }
    const withPending: AppState = { data: s.data, ui }
    const chat = activeChat(withPending)
    expect(chat).not.toBeNull()
    expect(chat!.id).toBe('ch-pending-1')
    expect(chat!.name).toBe('New chat')
    expect(chat!.phaseId).toBe('')
    expect(chat!.color).toBe('#0a0b0d')
    expect(chat!.messages).toHaveLength(1)
    expect(chat!.messages[0].role).toBe('assistant')
    expect(chat!.messages[0].content).toBe(greetingFor(withPending, eng))
    expect(eng.chats.some(c => c.id === 'ch-pending-1')).toBe(false)
  })

  it('prefers a real chat over a stale pending entry pointing at a different id', () => {
    const s = boot()
    const eng = s.data.companies[0].engagements[0]
    const realChat = eng.chats[0]
    const ui = {
      ...s.ui,
      activeCompanyId: s.data.companies[0].id,
      activeEngagementId: eng.id,
      activeChatByEngagement: { [eng.id]: realChat.id },
      pendingChatByEngagement: { [eng.id]: { id: 'ch-pending-2', draft: 'ignored' } },
    }
    const withBoth: AppState = { data: s.data, ui }
    expect(activeChat(withBoth)!.id).toBe(realChat.id)
  })
})

describe('getDraft', () => {
  it('reads the pending chat draft while a pending chat is active', () => {
    const s = boot()
    const eng = s.data.companies[0].engagements[0]
    const ui = {
      ...s.ui,
      activeCompanyId: s.data.companies[0].id,
      activeEngagementId: eng.id,
      activeChatByEngagement: { [eng.id]: 'ch-pending-1' },
      pendingChatByEngagement: { [eng.id]: { id: 'ch-pending-1', draft: 'hello' } },
    }
    expect(getDraft({ data: s.data, ui })).toBe('hello')
  })

  it('reads the per-chat draft for a real chat, defaulting to empty string', () => {
    const s = boot()
    const eng = s.data.companies[0].engagements[0]
    const realChat = eng.chats[0]
    const ui = {
      ...s.ui,
      activeCompanyId: s.data.companies[0].id,
      activeEngagementId: eng.id,
      activeChatByEngagement: { [eng.id]: realChat.id },
      draftByChatId: { [realChat.id]: 'unsent reply' },
    }
    expect(getDraft({ data: s.data, ui })).toBe('unsent reply')
    expect(getDraft({ data: s.data, ui: { ...ui, draftByChatId: {} } })).toBe('')
  })
})
```

- [ ] **Step 2: Run the test file to confirm it fails**

Run: `cd nexra && npx vitest run test/selectors.test.ts`
Expected: FAIL — `pendingChatByEngagement`/`draftByChatId` don't exist on
`UIState` yet (TS errors surfaced as runtime `undefined` access, and/or
`greetingFor`/`getDraft` not exported).

- [ ] **Step 3: Add `PendingChat` and the new `UIState` fields**

In `nexra/src/state/types.ts`, replace:

```ts
export interface CtxMenuState { open: boolean; x: number; y: number; engId: string | null; chatId: string | null }
export interface CompanyCtxMenuState { open: boolean; x: number; y: number; companyId: string | null }

export interface UIState {
  view: 'home' | 'workspace'
  activeCompanyId: string | null
  activeEngagementId: string | null
  activeChatByEngagement: Record<string, string>
  draft: string
  rightOpen: boolean
```

with:

```ts
export interface CtxMenuState { open: boolean; x: number; y: number; engId: string | null; chatId: string | null }
export interface CompanyCtxMenuState { open: boolean; x: number; y: number; companyId: string | null }
export interface PendingChat { id: string; draft: string }

export interface UIState {
  view: 'home' | 'workspace'
  activeCompanyId: string | null
  activeEngagementId: string | null
  activeChatByEngagement: Record<string, string>
  pendingChatByEngagement: Record<string, PendingChat>
  draftByChatId: Record<string, string>
  rightOpen: boolean
```

- [ ] **Step 4: Update `initialUI`**

In `nexra/src/state/reducer.ts`, replace:

```ts
export const initialUI: UIState = {
  view: 'home', activeCompanyId: null, activeEngagementId: null, activeChatByEngagement: {},
  draft: '', rightOpen: true, editingName: false, nameDraft: '', colorMenuOpen: false,
```

with:

```ts
export const initialUI: UIState = {
  view: 'home', activeCompanyId: null, activeEngagementId: null, activeChatByEngagement: {},
  pendingChatByEngagement: {}, draftByChatId: {},
  rightOpen: true, editingName: false, nameDraft: '', colorMenuOpen: false,
```

- [ ] **Step 5: Add `greetingFor`, pending-aware `activeChat`, and `getDraft` to `selectors.ts`**

Replace the whole file `nexra/src/state/selectors.ts` with:

```ts
import type { Snapshot, Company, Engagement, Chat, Severity } from '../../electron/services/store.types'
import type { UIState } from './types'
import { chatColors } from '../../electron/services/seed'
export interface AppState { data: Snapshot; ui: UIState }

export const activeCompany = (s: AppState): Company | null =>
  s.data.companies.find(c => c.id === s.ui.activeCompanyId) || null
export const activeEngagement = (s: AppState): Engagement | null => {
  const c = activeCompany(s); if (!c) return null
  return c.engagements.find(e => e.id === s.ui.activeEngagementId) || null
}
export const engagementById = (s: AppState, id: string): Engagement | null => {
  const c = activeCompany(s); if (!c) return null
  return c.engagements.find(e => e.id === id) || null
}
// The M1 stand-in greeting (see reducer.ts makeChat) — shared with the pending-chat
// view-model below so a not-yet-persisted "new chat" reads identically to a real one.
export const greetingFor = (s: AppState, eng: Engagement): string => {
  const cfg = s.data.types[eng.type]
  return "I'm the agent for this " + cfg.label + ". Ask me to enumerate configuration, run automated checks, or log findings — this chat keeps its own context."
}
export const activeChat = (s: AppState): Chat | null => {
  const e = activeEngagement(s); if (!e) return null
  const id = s.ui.activeChatByEngagement[e.id]
  const real = e.chats.find(ch => ch.id === id)
  if (real) return real
  const pending = s.ui.pendingChatByEngagement[e.id]
  if (!pending || pending.id !== id) return null
  return {
    id: pending.id, name: 'New chat', phaseId: '', color: '#0a0b0d', findings: [],
    messages: [{ id: 'pending-greeting-' + pending.id, role: 'assistant', kind: 'text', content: greetingFor(s, e) }],
  }
}
export const chatByIds = (s: AppState, engId: string, chatId: string): Chat | null => {
  const e = engagementById(s, engId); if (!e) return null
  return e.chats.find(c => c.id === chatId) || null
}
// Scans every company/engagement/chat — needed because agent events only carry a chatId,
// not the active company/engagement context (the active-chat helpers above aren't enough).
export const chatByGlobalId = (s: AppState, chatId: string): Chat | null => {
  for (const c of s.data.companies) {
    for (const e of c.engagements) {
      const ch = e.chats.find(x => x.id === chatId)
      if (ch) return ch
    }
  }
  return null
}
// Per-chat composer draft — resolves to the pending chat's own draft slot while
// viewing an uncommitted "new chat", else the persisted chat's draftByChatId entry.
export const getDraft = (s: AppState): string => {
  const e = activeEngagement(s); if (!e) return ''
  const id = s.ui.activeChatByEngagement[e.id]
  const pending = s.ui.pendingChatByEngagement[e.id]
  if (pending && pending.id === id) return pending.draft
  return id ? (s.ui.draftByChatId[id] ?? '') : ''
}

export const phaseLabel = (eng: Engagement | null, id: string): string =>
  (eng?.phases.find(p => p.id === id) || { label: '' }).label
export const statusColor = (st: string): string => (st === 'Complete' ? '#46c47f' : '#e6a23c')
export const sevColor = (sev: Severity): string =>
  ({ Critical: '#f0616d', High: '#f0954a', Medium: '#e6b23f', Low: '#7c828b' } as const)[sev]
export const colorDot = (bg: string): string => chatColors.find(c => c.bg === bg)?.dot ?? chatColors[0].dot
```

- [ ] **Step 6: Run the test file to confirm it passes**

Run: `cd nexra && npx vitest run test/selectors.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 7: Run the full suite to confirm nothing else broke**

Run: `cd nexra && npx vitest run`
Expected: PASS — all existing tests still green (no consumer of `UIState.draft`
has been touched yet, so `reducer.test.ts` / `ipc.test.ts` / component tests
are unaffected).

- [ ] **Step 8: Typecheck**

Run: `cd nexra && npm run typecheck`
Expected: PASS — no other file references `UIState.draft` yet in a way that
fails to compile (Task 3 removes the two remaining references, in
`ChatPane.tsx`; `reducer.ts`'s own `setDraft` case still assigns `U.draft`
until Task 2, so **this step will actually fail with `Property 'draft' does
not exist on type 'UIState'` at `reducer.ts`'s `setDraft` case** — that's
expected and is fixed in Task 2. Confirm the *only* typecheck error is that
one line, then proceed.)

- [ ] **Step 9: Commit**

```bash
git add nexra/src/state/types.ts nexra/src/state/reducer.ts nexra/src/state/selectors.ts nexra/test/selectors.test.ts
git commit -m "feat(state): add pending-chat and per-chat draft fields to UIState

Additive only — nothing yet creates a pending chat, so existing
createChat/appendUserMessage behavior is unchanged. Task 2 wires the
new fields into chat creation and leaves setDraft's remaining type
error (UIState.draft removal) to be fixed there."
```

---

### Task 2: Lazy pending-chat creation, settle-on-leave, message-triggered promotion

**Files:**
- Modify: `nexra/src/state/reducer.ts` (imports, `makeChat`, new helpers,
  `Action` union, `clone`, the reducer wrapper, `createChat`, `createProject`,
  `setDraft`, `appendUserMessage` cases; remove `engagementForChat`)
- Modify: `nexra/src/ipc.ts:67-98` (`sendMessage`)
- Modify: `nexra/test/reducer.test.ts` (fix 3 existing tests broken by the
  behavior change; add 3 new tests for the new behavior)

**Interfaces:**
- Consumes: Task 1's `PendingChat`, `UIState.pendingChatByEngagement`,
  `UIState.draftByChatId`, `greetingFor` (from `selectors.ts`).
- Produces: `makeChat(state: AppState, eng: Engagement, id?: string): Chat`
  (signature changed — was `(state, engId: string)`); `startPendingChat(state:
  AppState, engId: string): void`; `engagementInCompany(state: AppState,
  companyId: string, engId: string): Engagement | null`; `settlePendingChat(
  state: AppState, companyId: string, engId: string, pending: PendingChat):
  AppState`; `resolveChatForMessage(state: AppState, eng: Engagement, chatId:
  string): Chat | null`; the exported `reducer` is now a thin wrapper — the
  old switch-statement body is renamed `rawReducer` (not exported); `Action`'s
  `appendUserMessage` variant gains a required `engId: string` field.
  Consumed by Task 3 (rendering, no reducer API changes needed there) and
  Task 4 (more tests against this same surface).

  Note: `settlePendingChat` takes the company id explicitly (rather than
  resolving the engagement via the currently-*active* company, like
  `engagementById` does) because by the time the wrapper calls it, an
  `openCompany` dispatch may have already switched `activeCompanyId` away
  from the company the pending chat actually belongs to — `engagementById`
  would silently fail to find it and the commit would be lost.

- [ ] **Step 1: Update the tests that pin the old (immediate-real-chat)
      behavior — write them RED against the still-old reducer**

In `nexra/test/reducer.test.ts`, replace the `'creates a provisional chat...'`
test:

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

with:

```ts
  it('creates a pending chat, makes it active, seeds a greeting — without persisting it yet', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const engId = activeEngagement(s)!.id
    s = reducer(s, { t: 'createChat', engId })
    const chat = activeChat(s)!
    expect(chat.name).toBe('New chat')
    expect(chat.phaseId).toBe('')
    expect(chat.color).toBe('#0a0b0d')
    expect(chat.messages[0].role).toBe('assistant')
    expect(activeEngagement(s)!.chats.some(c => c.id === chat.id)).toBe(false)
  })

  it('createProject lands the user on an active pending chat for the new engagement', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    s = reducer(s, { t: 'createProject' })
    const eng = activeEngagement(s)!
    expect(eng.chats).toHaveLength(0)
    const chat = activeChat(s)!
    expect(chat.name).toBe('New chat')
    expect(chat.messages[0].role).toBe('assistant')
  })

  it('sending a message while viewing a pending chat promotes it into a real, persisted chat', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const engId = activeEngagement(s)!.id
    s = reducer(s, { t: 'createChat', engId })
    const chatId = activeChat(s)!.id
    expect(activeEngagement(s)!.chats.some(c => c.id === chatId)).toBe(false)
    s = reducer(s, { t: 'appendUserMessage', chatId, engId, text: 'hello agent' })
    expect(activeEngagement(s)!.chats.some(c => c.id === chatId)).toBe(true)
    const chat = chatByGlobalId(s, chatId)!
    expect(chat.messages.some(m => m.role === 'user' && m.content === 'hello agent')).toBe(true)
  })
```

Replace the id-counter test:

```ts
  it('advances the id counter past hydrated ids so a new chat cannot collide (dup-highlight bug)', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const engId = activeEngagement(s)!.id
    // Probe the live counter, then build "persisted" data whose chat id sits well
    // above it — mimics a relaunch where the counter reset to 1000 but sqlite
    // still holds higher ids minted in a prior session.
    s = reducer(s, { t: 'createChat', engId })
    const probe = parseInt(activeChat(s)!.id.replace(/^\D+/, ''), 10)
    const highNum = probe + 500
    const data = JSON.parse(JSON.stringify(s.data)) as typeof s.data
    const eng = data.companies.flatMap((c: any) => c.engagements).find((e: any) => e.id === engId)
    eng.chats.unshift({ id: 'ch' + highNum, name: 'Persisted', phaseId: '', color: '#0a0b0d', messages: [], findings: [] })

    s = reducer(s, { t: 'hydrate', data })
    s = reducer(s, { t: 'createChat', engId })

    const newNum = parseInt(activeChat(s)!.id.replace(/^\D+/, ''), 10)
    const ids = activeEngagement(s)!.chats.map(c => c.id)
    expect(newNum).toBeGreaterThan(highNum)                       // clears the hydrated id
    expect(new Set(ids).size).toBe(ids.length)                   // no duplicate ids
  })
```

with:

```ts
  it('advances the id counter past hydrated ids so a new chat cannot collide (dup-highlight bug)', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const engId = activeEngagement(s)!.id
    // Probe the live counter, then build "persisted" data whose chat id sits well
    // above it — mimics a relaunch where the counter reset to 1000 but sqlite
    // still holds higher ids minted in a prior session.
    s = reducer(s, { t: 'createChat', engId })
    const probe = parseInt(activeChat(s)!.id.replace(/^\D+/, ''), 10)
    // Hold the pending chat open with a draft so the second "+ New chat" below
    // commits it (instead of discarding it) — otherwise it never reaches
    // eng.chats and the duplicate-id check below is vacuous.
    s = reducer(s, { t: 'setDraft', value: 'hold this chat open' })
    const highNum = probe + 500
    const data = JSON.parse(JSON.stringify(s.data)) as typeof s.data
    const eng = data.companies.flatMap((c: any) => c.engagements).find((e: any) => e.id === engId)
    eng.chats.unshift({ id: 'ch' + highNum, name: 'Persisted', phaseId: '', color: '#0a0b0d', messages: [], findings: [] })

    s = reducer(s, { t: 'hydrate', data })
    s = reducer(s, { t: 'createChat', engId })   // leaves the first pending chat — commits it (non-blank draft) — then opens a second pending chat

    const newNum = parseInt(activeChat(s)!.id.replace(/^\D+/, ''), 10)
    const ids = activeEngagement(s)!.chats.map(c => c.id)
    expect(newNum).toBeGreaterThan(highNum)                       // clears the hydrated id
    expect(new Set(ids).size).toBe(ids.length)                   // no duplicate ids
    expect(ids).toContain('ch' + probe)                          // the held-open first chat was committed, not lost
  })
```

Update the focus-inference test — add `engId` to the `appendUserMessage`
dispatch (required from this task on):

```ts
  it('infers focus from the first message; title stays provisional pending the live call', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const engId = activeEngagement(s)!.id
    s = reducer(s, { t: 'createChat', engId })
    const chatId = activeChat(s)!.id
    s = reducer(s, { t: 'appendUserMessage', chatId, engId, text: 'review iam roles for privilege escalation' })
    const chat = chatByGlobalId(s, chatId)!
    expect(chat.name).toBe('New chat')
    expect(chat.phaseId).toBe('iam')
  })
```

Update the `setChatTitle` test — it previously dispatched `setChatTitle`
directly on a chat that used to be created real by `createChat`; now it must
first promote the chat via a message (matching real usage — `ipc.ts` only ever
dispatches `setChatTitle` after `appendUserMessage`):

```ts
  it('setChatTitle sets the title on a still-provisional chat', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const engId = activeEngagement(s)!.id
    s = reducer(s, { t: 'createChat', engId })
    const chatId = activeChat(s)!.id
    s = reducer(s, { t: 'appendUserMessage', chatId, engId, text: 'review iam roles' })
    s = reducer(s, { t: 'setChatTitle', chatId, title: 'Review IAM Privilege Escalation' })
    expect(chatByGlobalId(s, chatId)!.name).toBe('Review IAM Privilege Escalation')
  })
```

- [ ] **Step 2: Run the reducer test file to confirm it fails**

Run: `cd nexra && npx vitest run test/reducer.test.ts`
Expected: FAIL on the new/updated assertions above (`createChat` still
creates a real chat immediately; `appendUserMessage` doesn't accept `engId`
yet at the type level, though it runs fine at the JS level since Vitest
doesn't type-check test files) — the `.some(c => c.id === chat.id)).toBe(false)`
assertions fail because the chat IS already in `eng.chats` under the old code.

- [ ] **Step 3: Update reducer.ts imports**

Replace:

```ts
import type { AppState } from './selectors'
import { activeCompany, engagementById, chatByIds, chatByGlobalId } from './selectors'
import type { UIState } from './types'
import type { Chat, Message, Finding, Phase, EngagementScope, InputRequestItem } from '../../electron/services/store.types'
import type { AgentEvent } from '../../electron/services/agent.types'
import { chatColors } from '../../electron/services/seed'
```

with:

```ts
import type { AppState } from './selectors'
import { activeCompany, activeEngagement, engagementById, chatByIds, chatByGlobalId, greetingFor } from './selectors'
import type { UIState, PendingChat } from './types'
import type { Chat, Message, Finding, Phase, Engagement, EngagementScope, InputRequestItem } from '../../electron/services/store.types'
import type { AgentEvent } from '../../electron/services/agent.types'
import { chatColors } from '../../electron/services/seed'
```

- [ ] **Step 4: Replace `makeChat` + `engagementForChat` with the pending-chat helpers**

Replace:

```ts
function makeChat(state: AppState, engId: string): Chat {
  const eng = engagementById(state, engId)!
  const cfg = state.data.types[eng.type]
  const greeting: Message = { id: nextId('m'), role: 'assistant', kind: 'text',
    content: "I'm the agent for this " + cfg.label + ". Ask me to enumerate configuration, run automated checks, or log findings — this chat keeps its own context." }
  return { id: nextId('ch'), name: 'New chat', phaseId: '', color: '#0a0b0d', messages: [greeting], findings: [] }
}

function engagementForChat(state: AppState, chatId: string) {
  for (const c of state.data.companies)
    for (const e of c.engagements)
      if (e.chats.some(ch => ch.id === chatId)) return e
  return null
}
```

with:

```ts
function makeChat(state: AppState, eng: Engagement, id: string = nextId('ch')): Chat {
  const greeting: Message = { id: nextId('m'), role: 'assistant', kind: 'text', content: greetingFor(state, eng) }
  return { id, name: 'New chat', phaseId: '', color: '#0a0b0d', messages: [greeting], findings: [] }
}

// "+ New chat" and a new engagement both land the user on an uncommitted, in-memory
// placeholder — never written into eng.chats, never persisted — until it either
// gains a draft (see settlePendingChat) or a sent message (see resolveChatForMessage).
function startPendingChat(state: AppState, engId: string): void {
  const id = nextId('ch')
  state.ui.pendingChatByEngagement[engId] = { id, draft: '' }
  state.ui.activeChatByEngagement[engId] = id
}

// Looks up an engagement by (companyId, engId) rather than "the currently active
// company" — settlePendingChat below may run after activeCompanyId has already
// changed (e.g. an openCompany dispatch), so engagementById (which is scoped to
// the active company) would silently fail to find the engagement being settled.
function engagementInCompany(state: AppState, companyId: string, engId: string): Engagement | null {
  const c = state.data.companies.find(x => x.id === companyId)
  return c?.engagements.find(e => e.id === engId) ?? null
}

// Called by the reducer wrapper (see `reducer` below) whenever the user leaves a
// pending chat. A non-blank draft commits it into a real, persisted chat; a blank
// one is simply discarded — it was never written to eng.chats, so there is nothing
// to clean up. Guards against the pending entry having already been replaced (e.g.
// clicking "+ New chat" again while the first is still uncommitted) by only clearing
// the map slot if it still points at the chat being settled.
function settlePendingChat(state: AppState, companyId: string, engId: string, pending: PendingChat): AppState {
  const stillTracked = state.ui.pendingChatByEngagement[engId]?.id === pending.id
  const eng = engagementInCompany(state, companyId, engId)
  if (eng && pending.draft.trim() && !eng.chats.some(c => c.id === pending.id)) {
    const chat = makeChat(state, eng, pending.id)
    eng.chats = [chat, ...eng.chats]
    eng.updated = 'just now'
    state.ui.draftByChatId[pending.id] = pending.draft
  } else if (eng && state.ui.activeChatByEngagement[engId] === pending.id) {
    // discarded — fall back to another real chat if one exists, else clear
    if (eng.chats[0]) state.ui.activeChatByEngagement[engId] = eng.chats[0].id
    else delete state.ui.activeChatByEngagement[engId]
  }
  if (stillTracked) delete state.ui.pendingChatByEngagement[engId]
  return state
}

// Sending a message is a stronger signal than leaving with a draft, and can't wait
// for the leave-hook because the user stays on the same chat afterward. Promotes
// unconditionally (even a blank draft) since a real message is unambiguous content.
function resolveChatForMessage(state: AppState, eng: Engagement, chatId: string): Chat | null {
  const real = eng.chats.find(c => c.id === chatId)
  if (real) return real
  const pending = state.ui.pendingChatByEngagement[eng.id]
  if (!pending || pending.id !== chatId) return null
  const chat = makeChat(state, eng, pending.id)
  eng.chats = [chat, ...eng.chats]
  eng.updated = 'just now'
  delete state.ui.pendingChatByEngagement[eng.id]
  return chat
}
```

- [ ] **Step 5: Add `engId` to the `appendUserMessage` action**

Replace:

```ts
  | { t: 'appendUserMessage'; chatId: string; text: string }
```

with:

```ts
  | { t: 'appendUserMessage'; chatId: string; text: string; engId: string }
```

- [ ] **Step 6: Clone the two new UI maps**

Replace:

```ts
const clone = (s: AppState): AppState => ({ data: { ...s.data, companies: s.data.companies.map(c => ({ ...c, engagements: c.engagements.map(e => ({ ...e, chats: e.chats.map(ch => ({ ...ch, messages: [...ch.messages], findings: [...ch.findings] })) })) })) }, ui: { ...s.ui, activeChatByEngagement: { ...s.ui.activeChatByEngagement }, ctxMenu: { ...s.ui.ctxMenu }, companyCtxMenu: { ...s.ui.companyCtxMenu }, streamingChats: { ...s.ui.streamingChats } } })
```

with:

```ts
const clone = (s: AppState): AppState => ({ data: { ...s.data, companies: s.data.companies.map(c => ({ ...c, engagements: c.engagements.map(e => ({ ...e, chats: e.chats.map(ch => ({ ...ch, messages: [...ch.messages], findings: [...ch.findings] })) })) })) }, ui: { ...s.ui, activeChatByEngagement: { ...s.ui.activeChatByEngagement }, pendingChatByEngagement: { ...s.ui.pendingChatByEngagement }, draftByChatId: { ...s.ui.draftByChatId }, ctxMenu: { ...s.ui.ctxMenu }, companyCtxMenu: { ...s.ui.companyCtxMenu }, streamingChats: { ...s.ui.streamingChats } } })
```

- [ ] **Step 7: Rename the switch-statement function to `rawReducer` (drop `export`)**

Replace:

```ts
export function reducer(state: AppState, a: Action): AppState {
  const s = clone(state)
  const U = s.ui
  switch (a.t) {
```

with:

```ts
function rawReducer(state: AppState, a: Action): AppState {
  const s = clone(state)
  const U = s.ui
  switch (a.t) {
```

- [ ] **Step 8: Add the exported `reducer` wrapper after the switch statement**

Replace:

```ts
    default: return state
  }
}
export { chatColors }
```

with:

```ts
    default: return state
  }
}

// Every dispatch is routed through this wrapper so that leaving a pending chat —
// via any action that changes the active chat/engagement/company, or navigating
// back to Home — settles it exactly once, without special-casing every action
// that can cause a "leave". `prevCompanyId`/`prevPending` are captured before
// rawReducer runs so they still hold the correct values even if the action
// itself already changed activeCompanyId or replaced the live
// pendingChatByEngagement[engId] entry (e.g. "+ New chat" clicked twice in a
// row, or switching companies while a draft-holding pending chat is active).
export function reducer(state: AppState, a: Action): AppState {
  const prevCompanyId = state.ui.activeCompanyId
  const prevEngId = state.ui.activeEngagementId
  const prevPending = prevEngId ? state.ui.pendingChatByEngagement[prevEngId] : undefined
  const wasViewingPending = !!(prevPending && state.ui.activeChatByEngagement[prevEngId!] === prevPending.id)

  const next = rawReducer(state, a)
  if (!wasViewingPending) return next

  const stillOnSameEngagement = next.ui.activeEngagementId === prevEngId
  const stillActivePending = next.ui.view === 'workspace'
    && stillOnSameEngagement
    && next.ui.activeChatByEngagement[prevEngId!] === prevPending!.id
    && next.ui.pendingChatByEngagement[prevEngId!]?.id === prevPending!.id

  return stillActivePending ? next : settlePendingChat(next, prevCompanyId!, prevEngId!, prevPending!)
}

export { chatColors }
```

- [ ] **Step 9: Update `createChat` to start a pending chat**

Replace:

```ts
    case 'createChat': {
      const id = a.engId || U.activeEngagementId; const eng = id ? engagementById(s, id) : null; if (!eng) return state
      U.activeEngagementId = eng.id
      const chat = makeChat(s, eng.id)
      eng.chats = [chat, ...eng.chats]; eng.updated = 'just now'
      U.activeChatByEngagement[eng.id] = chat.id; U.editingName = false; return s
    }
```

with:

```ts
    case 'createChat': {
      const id = a.engId || U.activeEngagementId; const eng = id ? engagementById(s, id) : null; if (!eng) return state
      U.activeEngagementId = eng.id
      startPendingChat(s, eng.id)
      U.editingName = false; return s
    }
```

- [ ] **Step 10: Update `createProject` to also start a pending chat**

Replace:

```ts
    case 'createProject': {
      const cfg = s.data.types[U.selectedType as keyof typeof s.data.types]
      const eng = { id: nextId('e'), type: U.selectedType as any, name: U.newName.trim() || cfg.label, status: 'In Progress' as const, updated: 'just now', linear: cfg.linear, phases: cfg.phases, scope: cfg.scope.map(x => ({ ...x })), chats: [] }
      const c = activeCompany(s)!; c.updated = 'just now'; c.engagements = [eng, ...c.engagements]
      U.activeEngagementId = eng.id; U.newOpen = false; U.editingName = false; return s
    }
```

with:

```ts
    case 'createProject': {
      const cfg = s.data.types[U.selectedType as keyof typeof s.data.types]
      const eng = { id: nextId('e'), type: U.selectedType as any, name: U.newName.trim() || cfg.label, status: 'In Progress' as const, updated: 'just now', linear: cfg.linear, phases: cfg.phases, scope: cfg.scope.map(x => ({ ...x })), chats: [] }
      const c = activeCompany(s)!; c.updated = 'just now'; c.engagements = [eng, ...c.engagements]
      U.activeEngagementId = eng.id; U.newOpen = false; U.editingName = false
      startPendingChat(s, eng.id)
      return s
    }
```

- [ ] **Step 11: Update `setDraft` to resolve pending-vs-real**

Replace:

```ts
    case 'setDraft': U.draft = a.value; return s
```

with:

```ts
    case 'setDraft': {
      const eng = activeEngagement(s); if (!eng) return state
      const id = U.activeChatByEngagement[eng.id]
      const pending = U.pendingChatByEngagement[eng.id]
      if (pending && pending.id === id) U.pendingChatByEngagement[eng.id] = { ...pending, draft: a.value }
      else if (id) U.draftByChatId[id] = a.value
      return s
    }
```

- [ ] **Step 12: Update `appendUserMessage` to promote a pending chat**

Replace:

```ts
    case 'appendUserMessage': {
      const c = chatByGlobalId(s, a.chatId); if (!c) return state
      const firstUser = !c.messages.some(m => m.role === 'user')
      c.messages.push({ id: nextId('m'), role: 'user', kind: 'text', content: a.text })
      // First question on a still-provisional chat → infer focus. The title
      // itself arrives asynchronously via 'setChatTitle' once the live
      // cheap-model call resolves (see ipc.ts sendMessage).
      if (firstUser && c.name === 'New chat') {
        const eng = engagementForChat(s, a.chatId)
        if (eng) c.phaseId = inferFocus(a.text, eng.phases)
      }
      return s
    }
```

with:

```ts
    case 'appendUserMessage': {
      const eng = engagementById(s, a.engId); if (!eng) return state
      const c = resolveChatForMessage(s, eng, a.chatId); if (!c) return state
      const firstUser = !c.messages.some(m => m.role === 'user')
      c.messages.push({ id: nextId('m'), role: 'user', kind: 'text', content: a.text })
      // First question on a still-provisional chat → infer focus. The title
      // itself arrives asynchronously via 'setChatTitle' once the live
      // cheap-model call resolves (see ipc.ts sendMessage).
      if (firstUser && c.name === 'New chat') c.phaseId = inferFocus(a.text, eng.phases)
      return s
    }
```

- [ ] **Step 13: Pass `engId` from `ipc.ts`'s `sendMessage`**

In `nexra/src/ipc.ts`, replace:

```ts
  dispatch({ t: 'appendUserMessage', chatId: chat.id, text: trimmed })
```

with:

```ts
  dispatch({ t: 'appendUserMessage', chatId: chat.id, engId: eng.id, text: trimmed })
```

- [ ] **Step 14: Run the reducer test file to confirm it passes**

Run: `cd nexra && npx vitest run test/reducer.test.ts`
Expected: PASS (30 tests: 27 original + 3 new, with 3 rewritten in place)

- [ ] **Step 15: Run the full suite and typecheck**

Run: `cd nexra && npx vitest run && npm run typecheck`
Expected: PASS. (`test/ipc.test.ts`'s existing `toContainEqual({ t:
'appendUserMessage', chatId: 'c1', text: 'hello there' })`-style assertions
still pass unmodified — Vitest's `toEqual`/`toContainEqual` ignore extra
`undefined`-valued keys, and the `eng` test fixture there has no `id`, so the
newly-added `engId` is `undefined` and doesn't affect the comparison. No
changes needed in `ipc.test.ts`.)

- [ ] **Step 16: Commit**

```bash
git add nexra/src/state/reducer.ts nexra/src/ipc.ts nexra/test/reducer.test.ts
git commit -m "feat(reducer): lazy pending-chat creation with settle-on-leave

'+ New chat' and creating an engagement now land on an in-memory
pending chat instead of an immediately-persisted one. A single
reducer wrapper commits it (non-blank draft) or discards it (blank)
whenever the user leaves — switches chats/engagements/projects, or
goes Home. Sending a message promotes a pending chat unconditionally."
```

---

### Task 3: Wire the composer and sidebar to the new draft/pending model

**Files:**
- Modify: `nexra/src/components/ChatPane.tsx`
- Modify: `nexra/src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: Task 1's `getDraft(s: AppState): string`; Task 1/2's
  `UIState.pendingChatByEngagement`.
- Produces: no new exports — this is a leaf rendering change. Nothing later
  depends on it.

No new automated test is added in this task: the underlying pending/draft
*logic* is already fully covered by the reducer/selector tests in Tasks 1, 2,
and 4. `ChatPane`/`Sidebar` here only read already-tested selectors and render
already-tested state — a DOM snapshot of a decorative placeholder row would
be brittle without adding real coverage. Correctness of the rendering itself
is confirmed by typecheck plus the manual smoke test in Task 5.

- [ ] **Step 1: `ChatPane.tsx` — read the draft through `getDraft`**

Replace:

```ts
import { activeCompany, activeEngagement, activeChat, phaseLabel } from '../state/selectors'
```

with:

```ts
import { activeCompany, activeEngagement, activeChat, getDraft, phaseLabel } from '../state/selectors'
```

Replace:

```ts
  const onSend = () => {
    sendMessage(dispatch, chat, eng, state.ui.draft, company?.id)
    dispatch({ t: 'setDraft', value: '' })
  }
```

with:

```ts
  const onSend = () => {
    sendMessage(dispatch, chat, eng, getDraft(state), company?.id)
    dispatch({ t: 'setDraft', value: '' })
  }
```

Replace:

```ts
      <Composer
        draft={state.ui.draft}
        placeholder={composerPlaceholder}
```

with:

```ts
      <Composer
        draft={getDraft(state)}
        placeholder={composerPlaceholder}
```

- [ ] **Step 2: `Sidebar.tsx` — compute a pending-chat placeholder per engagement**

Replace:

```ts
  const engagements = company
    ? company.engagements.map(e => {
        const activeChatId = state.ui.activeChatByEngagement[e.id]
        const isActiveEng = e.id === state.ui.activeEngagementId
        return {
          id: e.id,
          name: e.name,
          typeLabel: state.data.types[e.type].short,
          chatCountLabel: e.chats.length + (e.chats.length === 1 ? ' chat' : ' chats'),
          isActive: isActiveEng,
          statusColor: statusColor(e.status),
          noChats: e.chats.length === 0,
          chats: e.chats.map(ch => {
```

with:

```ts
  const engagements = company
    ? company.engagements.map(e => {
        const activeChatId = state.ui.activeChatByEngagement[e.id]
        const isActiveEng = e.id === state.ui.activeEngagementId
        const pending = state.ui.pendingChatByEngagement[e.id]
        const pendingActive = isActiveEng && !!pending && pending.id === activeChatId
        return {
          id: e.id,
          name: e.name,
          typeLabel: state.data.types[e.type].short,
          chatCountLabel: e.chats.length + (e.chats.length === 1 ? ' chat' : ' chats'),
          isActive: isActiveEng,
          statusColor: statusColor(e.status),
          noChats: e.chats.length === 0 && !pendingActive,
          pendingChatId: pendingActive ? pending!.id : null,
          chats: e.chats.map(ch => {
```

- [ ] **Step 3: `Sidebar.tsx` — render the placeholder row above the real chat list**

Replace:

```tsx
            {p.isActive && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, margin: '3px 0 9px', paddingLeft: 19, borderLeft: '1px solid rgba(255,255,255,0.06)', marginLeft: 15 }}>
                {p.chats.map(ch => (
```

with:

```tsx
            {p.isActive && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1, margin: '3px 0 9px', paddingLeft: 19, borderLeft: '1px solid rgba(255,255,255,0.06)', marginLeft: 15 }}>
                {p.pendingChatId && (
                  <div
                    style={{ position: 'relative', width: '100%', display: 'flex', gap: 9, alignItems: 'center', padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(111,123,240,0.26)', background: 'rgba(111,123,240,0.12)' }}
                  >
                    <span style={{ flex: 'none', width: 7, height: 7, borderRadius: 2, background: '#6f7bf0' }} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 500, color: '#e7e9ec', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>New chat</span>
                  </div>
                )}
                {p.chats.map(ch => (
```

- [ ] **Step 4: Typecheck and run the full suite**

Run: `cd nexra && npm run typecheck && npx vitest run`
Expected: PASS — no test exercises `Sidebar`'s new branch yet (none existed
before either), so this only needs to compile and not regress anything else.

- [ ] **Step 5: Commit**

```bash
git add nexra/src/components/ChatPane.tsx nexra/src/components/Sidebar.tsx
git commit -m "feat(ui): wire composer and sidebar to per-chat drafts and pending chats

ChatPane reads/writes the draft through the new getDraft selector
instead of the removed global UIState.draft. Sidebar shows a
highlighted 'New chat' placeholder row while a pending chat is
active, matching today's UX of the chat appearing immediately."
```

---

### Task 4: Full leave-scenario test coverage

**Files:**
- Modify: `nexra/test/reducer.test.ts` (new `describe` block)

**Interfaces:**
- Consumes: everything from Tasks 1–2 (`reducer`, `activeChat`,
  `activeEngagement`, `getDraft`, `chatByGlobalId`). Produces nothing new —
  this task is pure test coverage for scenarios not already exercised by
  Tasks 1–2's tests.

- [ ] **Step 1: Write the new tests**

Add to `nexra/test/reducer.test.ts` (new top-level `describe` block, after
the existing `describe('reducer', ...)` block):

```ts
describe('pending chat — leave scenarios', () => {
  it('discards a blank pending chat when switching to a real chat in the same engagement', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const engId = activeEngagement(s)!.id
    const otherRealChatId = activeEngagement(s)!.chats[0].id
    s = reducer(s, { t: 'createChat', engId })
    const pendingId = activeChat(s)!.id
    s = reducer(s, { t: 'selectChat', id: otherRealChatId })
    expect(activeEngagement(s)!.chats.some(c => c.id === pendingId)).toBe(false)
    expect(activeChat(s)!.id).toBe(otherRealChatId)
  })

  it('commits a pending chat with a draft when switching to a real chat in the same engagement', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const engId = activeEngagement(s)!.id
    const otherRealChatId = activeEngagement(s)!.chats[0].id
    s = reducer(s, { t: 'createChat', engId })
    const pendingId = activeChat(s)!.id
    s = reducer(s, { t: 'setDraft', value: 'unsent question' })
    s = reducer(s, { t: 'selectChat', id: otherRealChatId })
    expect(activeEngagement(s)!.chats.some(c => c.id === pendingId)).toBe(true)
    expect(activeChat(s)!.id).toBe(otherRealChatId) // navigation target is respected, not overridden
  })

  it('keeps each chat\'s draft independent when switching between them, and restores it on return', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const eng = activeEngagement(s)!
    const chatA = eng.chats[0].id
    const chatB = eng.chats[1].id
    s = reducer(s, { t: 'selectChat', id: chatA })
    s = reducer(s, { t: 'setDraft', value: 'draft for A' })
    s = reducer(s, { t: 'selectChat', id: chatB })
    expect(getDraft(s)).toBe('')
    s = reducer(s, { t: 'setDraft', value: 'draft for B' })
    s = reducer(s, { t: 'selectChat', id: chatA })
    expect(getDraft(s)).toBe('draft for A')
    s = reducer(s, { t: 'selectChat', id: chatB })
    expect(getDraft(s)).toBe('draft for B')
  })

  it('commits a draft-holding pending chat when switching engagement', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const engId = activeEngagement(s)!.id
    const otherEngId = s.data.companies.find(c => c.id === 'c1')!.engagements.find(e => e.id !== engId)!.id
    s = reducer(s, { t: 'createChat', engId })
    const pendingId = activeChat(s)!.id
    s = reducer(s, { t: 'setDraft', value: 'unsent question' })
    s = reducer(s, { t: 'selectEngagement', id: otherEngId })
    const eng = s.data.companies.find(c => c.id === 'c1')!.engagements.find(e => e.id === engId)!
    expect(eng.chats.some(c => c.id === pendingId)).toBe(true)
  })

  it('discards a blank pending chat when switching companies', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const engId = activeEngagement(s)!.id
    s = reducer(s, { t: 'createChat', engId })
    const pendingId = activeChat(s)!.id
    s = reducer(s, { t: 'openCompany', id: 'c2' })
    const eng = s.data.companies.find(c => c.id === 'c1')!.engagements.find(e => e.id === engId)!
    expect(eng.chats.some(c => c.id === pendingId)).toBe(false)
  })

  it('commits a draft-holding pending chat when switching companies', () => {
    // Regression guard: settlePendingChat must resolve the engagement by the
    // company it actually belongs to (captured before the dispatch), not by
    // whichever company is active by the time it runs — openCompany has
    // already flipped activeCompanyId to 'c2' before the wrapper settles.
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const engId = activeEngagement(s)!.id
    s = reducer(s, { t: 'createChat', engId })
    const pendingId = activeChat(s)!.id
    s = reducer(s, { t: 'setDraft', value: 'unsent question' })
    s = reducer(s, { t: 'openCompany', id: 'c2' })
    const eng = s.data.companies.find(c => c.id === 'c1')!.engagements.find(e => e.id === engId)!
    expect(eng.chats.some(c => c.id === pendingId)).toBe(true)
    expect(s.ui.activeCompanyId).toBe('c2')   // navigation target still respected
  })

  it('commits a draft-holding pending chat when going Home', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const engId = activeEngagement(s)!.id
    s = reducer(s, { t: 'createChat', engId })
    const pendingId = activeChat(s)!.id
    s = reducer(s, { t: 'setDraft', value: 'unsent question' })
    s = reducer(s, { t: 'goHome' })
    const eng = s.data.companies.find(c => c.id === 'c1')!.engagements.find(e => e.id === engId)!
    expect(eng.chats.some(c => c.id === pendingId)).toBe(true)
    expect(s.ui.view).toBe('home')
  })
})
```

This requires `getDraft` to be imported in the test file. Update the existing
selectors import line:

Replace:

```ts
import { activeChat, activeEngagement, chatByGlobalId } from '../src/state/selectors'
```

with:

```ts
import { activeChat, activeEngagement, chatByGlobalId, getDraft } from '../src/state/selectors'
```

- [ ] **Step 2: Run the test file to confirm it fails**

Run: `cd nexra && npx vitest run test/reducer.test.ts`
Expected: at this point Tasks 1–2 are already implemented (this is a later
task in the same branch), so most of these should already PASS as a
byproduct of Task 2's implementation. Run this step anyway as a genuine
verification: if anything in this new `describe` block fails, it indicates a
gap in Task 2's wrapper logic (most likely the cross-company or
goHome-settle paths, which Task 2's own tests didn't directly exercise) —
fix `settlePendingChat`/the `reducer` wrapper in `reducer.ts` until all pass,
rather than weakening these assertions.

- [ ] **Step 3: Run to confirm it passes**

Run: `cd nexra && npx vitest run test/reducer.test.ts`
Expected: PASS (37 tests total: 30 from Task 2 + 7 new)

- [ ] **Step 4: Commit**

```bash
git add nexra/test/reducer.test.ts
git commit -m "test(reducer): cover every pending-chat leave path

Switching chats, engagements, companies, and going Home all commit
a draft-holding pending chat or discard a blank one; per-chat drafts
stay isolated across switches."
```

---

### Task 5: Full verification

**Files:** none (verification only)

**Interfaces:** none.

- [ ] **Step 1: Full typecheck**

Run: `cd nexra && npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 2: Full test suite**

Run: `cd nexra && npm test`
Expected: PASS, all suites green (this also exercises `pretest`'s
`better-sqlite3` rebuild).

- [ ] **Step 3: Manual smoke test**

Use the `run` skill (or `npm run dev` directly) to launch the app and drive
the actual flow end-to-end:

1. Create a new engagement → confirm you land directly on a chat pane (no
   "No chats yet" empty state), with the sidebar showing a highlighted
   "New chat" row.
2. Navigate away (click another engagement, or "All Projects") without
   typing anything → confirm the chat is gone when you come back (sidebar
   shows "No chats yet" again for that engagement, or the placeholder is
   simply absent).
3. Create another chat, type a partial message in the composer, switch to a
   different chat, then switch back → confirm the draft is still there and
   was not shown in the other chat's composer.
4. Create a chat, type a partial message, switch engagements → confirm the
   chat now appears as a real row in the original engagement's sidebar list.
5. Create a chat and actually send a message → confirm it behaves exactly as
   before (streaming reply, title inference, focus inference).

Report back any visual or behavioral mismatch against these five checks
before considering the task done.

- [ ] **Step 4: No commit in this task** (verification only — if Step 3
      surfaces a bug, fix it under whichever earlier task it belongs to and
      commit there).
