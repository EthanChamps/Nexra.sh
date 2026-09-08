# New-chat lifecycle: lazy creation, per-chat drafts — Design

**Date:** 2026-07-03
**Status:** Approved (brainstorming), pending spec review
**Milestone context:** Redcell M4 (persistence in progress). See `docs/superpowers/HANDOVER.md`.

## Problem

Three related gaps in the current chat-creation/navigation flow:

1. **Creating an engagement doesn't create a chat.** `createProject` builds the
   new `Engagement` with `chats: []`, so the user lands on the "No chats yet"
   empty state (`Workspace.tsx`) and has to click "+ New chat" separately.
2. **Chats are never cleaned up.** "+ New chat" creates a real, persisted
   `Chat` immediately (per
   `docs/superpowers/specs/2026-07-01-instant-new-chat-design.md`). If the user
   never types anything and navigates elsewhere, that chat (name `"New chat"`,
   one greeting message, no real content) is left behind forever — nothing
   ever deletes it.
3. **The composer draft is global, not per-chat.** `UIState.draft: string` is
   a single field shared by every chat. Typing a partial message, then
   switching chats, carries the unsent text into the new chat's composer —
   it doesn't stay with the chat it was typed into, and it doesn't come back
   when you return to the original chat.

## Behaviour

- Creating a new engagement drops the user straight into a live "new chat"
  compose view — same as clicking "+ New chat" today, no separate empty state.
- A newly created chat is **not written to the store** until it has content.
  "Content" means either the user has typed a non-empty draft into it, or sent
  a message. If the user navigates away (switches chat, switches engagement,
  switches project, creates another new chat) while the chat is still empty
  and its draft is blank, it simply ceases to exist — nothing was ever
  persisted, so there is nothing to delete.
- If the user has typed a non-empty draft when they navigate away, the chat
  is **committed**: it becomes a real, persisted chat (greeting message +
  the typed draft carried over as its saved draft), so it shows up in the
  sidebar and survives future navigation.
- Each chat's draft is independent. Switching chats never shows another
  chat's unsent text, and returning to a chat restores whatever was typed
  there before.
- This cleanup/commit logic is scoped to **in-app navigation only** (switching
  the active chat/engagement/project during a running session). Quitting the
  app with an uncommitted draft simply loses it, same as today (drafts are
  not persisted to disk either way).
- Drafts are **in-memory only** (`UIState`, not written to sqlite) — matches
  current behavior (today's global `draft` field isn't persisted) and avoids
  a schema change.

## Data model

```ts
export interface PendingChat { id: string; draft: string }

export interface UIState {
  // ...unchanged fields...
  activeChatByEngagement: Record<string, string>       // unchanged shape — value may be a real OR a pending chat id
  pendingChatByEngagement: Record<string, PendingChat>  // at most one uncommitted "new chat" per engagement
  draftByChatId: Record<string, string>                 // per-chat draft, for chats already real/persisted
  // `draft: string` is removed
}
```

A `PendingChat` is a client-only, in-memory placeholder. It is never written
into `eng.chats` and never reaches the store. It becomes a real `Chat` (pushed
into `eng.chats`, including its greeting message) only at the moment it is
committed — see below. Because that push is a normal mutation of `AppState.data`,
it rides the existing 400ms debounced `store.save()` autosave (`App.tsx`); no
new IPC method is needed. `deleteChat` IPC is untouched — still only invoked by
explicit right-click "Delete chat", which continues to operate on real chats.

## Reducer changes

### 1. Single "leaving a chat" hook

Rather than adding settle/cleanup calls to every navigation action, the
reducer is wrapped once. The existing `reducer.ts` switch statement is renamed
`rawReducer`; the exported `reducer` becomes:

```ts
export function reducer(state: AppState, action: Action): AppState {
  const prevEngId = state.ui.activeEngagementId
  const prevPending = prevEngId ? state.ui.pendingChatByEngagement[prevEngId] : undefined
  const wasViewingPending = !!(prevPending && state.ui.activeChatByEngagement[prevEngId!] === prevPending.id)

  const next = rawReducer(state, action)
  if (!wasViewingPending) return next

  const stillOnSameEngagement = next.ui.activeEngagementId === prevEngId
  const stillActivePending = stillOnSameEngagement
    && next.ui.activeChatByEngagement[prevEngId!] === prevPending!.id
    && next.ui.pendingChatByEngagement[prevEngId!]?.id === prevPending!.id

  return stillActivePending ? next : settlePendingChat(next, prevEngId!, prevPending!)
}
```

`prevPending` is captured **before** `rawReducer` runs, so it still holds the
correct id/draft even if the action itself already replaced or cleared the
live `pendingChatByEngagement[engId]` entry (e.g. clicking "+ New chat" again
while the first new chat is still an uncommitted draft).

This single hook correctly covers every way of "leaving" a pending chat —
`selectChat` to a real chat, `selectEngagement`, `openCompany`, `createChat`
(a second new-chat), `createProject` (a new engagement) — with no per-action
special-casing.

### 2. `settlePendingChat(state, engId, pending)`

```ts
function settlePendingChat(state: AppState, engId: string, pending: PendingChat): AppState {
  if (!pending.draft.trim()) return state          // discard — never persisted, nothing to clean up
  const eng = engagementById(state, engId)
  if (!eng || eng.chats.some(c => c.id === pending.id)) return state  // already real, no-op
  const chat = makeChat(state, engId, pending.id)  // reuse the pending id so it stays stable
  eng.chats = [chat, ...eng.chats]
  state.ui.draftByChatId[pending.id] = pending.draft
  return state
}
```

`makeChat` gains an optional third `id?: string` parameter (defaults to
`nextId('ch')` as today) so promotion reuses the id the pending chat already
had.

### 3. `startPendingChat(state, engId)`

Shared by both "+ New chat" and engagement creation:

```ts
function startPendingChat(state: AppState, engId: string): void {
  const id = nextId('ch')
  state.ui.pendingChatByEngagement[engId] = { id, draft: '' }
  state.ui.activeChatByEngagement[engId] = id
}
```

- `createChat` case: resolve the engagement as today, then call
  `startPendingChat` instead of building/pushing a real `Chat` directly.
- `createProject` case: after building `eng` with `chats: []` as today, call
  `startPendingChat(s, eng.id)` so the user lands on a live compose view
  immediately, identical in kind to "+ New chat".

### 4. Draft read/write

`setDraft` resolves the target based on whether the active id is the pending
chat or a real one:

```ts
case 'setDraft': {
  const eng = activeEngagement(s); if (!eng) return state
  const id = U.activeChatByEngagement[eng.id]
  const pending = U.pendingChatByEngagement[eng.id]
  if (pending && pending.id === id) pending.draft = a.value
  else if (id) U.draftByChatId[id] = a.value
  return s
}
```

A parallel `getDraft(state)` selector performs the same lookup for rendering.

### 5. Sending a message promotes a pending chat unconditionally

Sending is a stronger signal than leaving with a non-blank draft, and it
can't wait for the "leaving" hook because the user stays on the same chat
afterward. `appendUserMessage` (and any other action that appends to
`chat.messages`, e.g. an agent reply) resolves the target chat with a
promote-if-needed step before appending:

```ts
function resolveChatForMessage(state: AppState, engId: string): Chat | null {
  const eng = engagementById(state, engId); if (!eng) return null
  const id = state.ui.activeChatByEngagement[engId]
  const real = eng.chats.find(c => c.id === id)
  if (real) return real
  const pending = state.ui.pendingChatByEngagement[engId]
  if (!pending || pending.id !== id) return null
  const chat = makeChat(state, engId, pending.id)
  eng.chats = [chat, ...eng.chats]
  delete state.ui.pendingChatByEngagement[engId]
  return chat
}
```

This runs regardless of the draft's contents (even if the draft was blank —
e.g. a message reaches the chat some other way) since a real message is
unambiguous content. `ChatPane`'s `onSend` continues to clear the draft via
`dispatch({ t: 'setDraft', value: '' })` after sending, which now resolves
through `draftByChatId` once the chat is real.

## Rendering changes

- **`activeChat` selector** (`state/selectors.ts`): if the active id for the
  engagement isn't found in `eng.chats`, look it up in
  `pendingChatByEngagement` and synthesize a view-model `Chat` (same greeting
  text `makeChat` already builds, factored into a shared `buildGreeting(state,
  engId)` helper) for rendering only — never stored, never part of `eng.chats`.
- **`Composer`**: draft prop comes from `getDraft(state)` instead of
  `state.ui.draft`.
- **`Sidebar`**: chat list continues to render only `eng.chats` (real chats).
  To preserve today's UX where a new chat visibly appears in the list the
  moment you create it, additionally render a non-deletable, highlighted "New
  chat" placeholder row at the top when that engagement's pending chat is the
  active one. The row disappears the instant you leave — committed pending
  chats become a real row in the normal list; discarded ones vanish.

## Persistence

No new IPC/store methods. Promotion to a real chat is a normal mutation of
`state.data`; the existing debounced autosave (`App.tsx`, 400ms after
`state.data` changes) picks it up like any other chat/message change. Nothing
changes about `deleteChat` (`store:deleteChat` IPC) — it remains the explicit,
user-triggered path for removing a real chat via the context menu.

## Testing

Reducer-level unit tests (existing `reducer.ts` test style):

- Leaving a pending chat with a blank draft discards it (`eng.chats` unchanged,
  `pendingChatByEngagement[engId]` cleared, no store call).
- Leaving a pending chat with a non-empty draft promotes it: a new `Chat`
  appears at the front of `eng.chats` with the greeting message plus the
  draft preserved in `draftByChatId`.
- Typing in one chat, then switching to another chat, does not leak the first
  chat's draft into the second chat's composer; returning to the first chat
  restores its own draft.
- Creating a second "+ New chat" while the first is still an uncommitted
  non-empty draft commits the first before creating the second.
- `createProject` lands the user on an active pending chat for the new
  engagement (same shape as "+ New chat").
- Switching engagement/project away from an active, draft-holding pending
  chat commits or discards it exactly as switching chats does.
- Sending a message while viewing a pending chat (blank or non-blank draft)
  promotes it immediately and appends the message to the newly-real chat.

## Out of scope

- Persisting drafts to disk (survive app restart) — explicitly deferred;
  drafts remain in-memory only, matching current behavior.
- Auto-deleting an *empty engagement* (one whose only chat was discarded,
  leaving `chats: []`) — the engagement itself is never auto-removed, same as
  today's "No chats yet" empty state for an engagement with zero chats.
- Cleaning up pre-existing "New chat" rows already sitting in the database
  from before this change — this design only prevents new empty chats from
  being persisted going forward; no migration/backfill is included.
- Any change to the app-quit path — cleanup/commit is triggered by in-app
  navigation actions only, not by window close or process exit.
