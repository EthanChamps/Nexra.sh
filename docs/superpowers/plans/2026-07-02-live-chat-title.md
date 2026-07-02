# Live Cheap-Model Chat Title Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the deterministic `deriveTitle()` mock with a real, cheap, non-blocking model call that auto-titles a chat from the user's first message — the same pattern ChatGPT/Claude use.

**Architecture:** A new main-process service (`agent.title.ts`) makes one short `generateText` completion via the already-wired `resolveModel(cfg)`, exposed over a new `agent:title` IPC channel. The renderer's `sendMessage()` fires this call fire-and-forget alongside the existing streaming reply, dispatching a new `setChatTitle` reducer action on success or falling back to the existing `deriveTitle` heuristic on failure.

**Tech Stack:** TypeScript, Vercel AI SDK v5 (`generateText`), Electron IPC (`ipcMain.handle`/`contextBridge`), Vitest (jsdom), existing `resolveModel`/`ProviderConfig` from `electron/services/providers.ts`.

## Global Constraints

- Reuse whatever provider/model is already configured in Settings (`loadConfig()` in `main.ts`) — no separate "cheap tier" setting, no hardcoded model id.
- The title call must never block or delay the main chat reply — it always runs fire-and-forget, concurrently with `agent.send`.
- On any failure (missing key, network, provider error) fall back silently to `deriveTitle(text)` — no user-visible error for this feature.
- Focus/phase inference (`inferFocus`) is unchanged and out of scope — do not touch its behavior.
- A chat the user has already renamed (`name !== 'New chat'`) must never be retitled, by either the live call or the fallback.
- Only the chat's first user message ever triggers title generation.
- Reference spec: `docs/superpowers/specs/2026-07-02-live-chat-title-design.md`.

---

### Task 1: Title-generation service (main process)

**Files:**
- Modify: `nexra/electron/services/agent.types.ts`
- Create: `nexra/electron/services/agent.title.ts`
- Test: `nexra/test/agent.title.test.ts`

**Interfaces:**
- Consumes: `resolveModel(cfg: ProviderConfig): LanguageModel` from `nexra/electron/services/providers.ts` (existing, unchanged).
- Produces: `export interface AgentTitleRequest { engagementType: string; text: string }` (in `agent.types.ts`); `export async function runTitle(req: AgentTitleRequest, cfg: ProviderConfig): Promise<string>` (in `agent.title.ts`) — resolves to the cleaned title string, or rejects on any error. Task 2 wires this behind IPC; Task 4 calls it (via the IPC bridge) from the renderer.

- [ ] **Step 1: Add `AgentTitleRequest` to `agent.types.ts`**

Add this line at the end of `nexra/electron/services/agent.types.ts` (after the existing `AgentInstallRequest` line):

```ts
export interface AgentTitleRequest { engagementType: string; text: string }
```

- [ ] **Step 2: Write the failing test**

Create `nexra/test/agent.title.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const generateText = vi.fn()
vi.mock('ai', () => ({ generateText: (o: any) => generateText(o) }))
vi.mock('../electron/services/providers', () => ({ resolveModel: () => ({ tag: 'fake-model' }) }))

import { runTitle } from '../electron/services/agent.title'
import type { AgentTitleRequest } from '../electron/services/agent.types'
import type { ProviderConfig } from '../electron/services/providers'

const req: AgentTitleRequest = { engagementType: 'aws', text: 'review iam roles for privilege escalation' }
const cfg: ProviderConfig = { provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'sk-1' }

describe('runTitle', () => {
  beforeEach(() => generateText.mockClear())

  it('sends an engagement-typed system prompt and the message as the user turn', async () => {
    generateText.mockResolvedValue({ text: 'Review IAM Privilege Escalation' })
    await runTitle(req, cfg)
    const call = generateText.mock.calls[0][0]
    expect(call.system).toContain('aws')
    expect(call.messages).toEqual([{ role: 'user', content: 'review iam roles for privilege escalation' }])
    expect(call.maxOutputTokens).toBe(20)
  })

  it('trims and strips wrapping quotes', async () => {
    generateText.mockResolvedValue({ text: '  "Review IAM Privilege Escalation"  ' })
    const title = await runTitle(req, cfg)
    expect(title).toBe('Review IAM Privilege Escalation')
  })

  it('caps an overlong title at 48 characters', async () => {
    generateText.mockResolvedValue({ text: 'x'.repeat(80) })
    const title = await runTitle(req, cfg)
    expect(title).toHaveLength(48)
  })

  it('propagates a provider error', async () => {
    generateText.mockRejectedValue(new Error('401 unauthorized'))
    await expect(runTitle(req, cfg)).rejects.toThrow('401 unauthorized')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd nexra && npx vitest run test/agent.title.test.ts`
Expected: FAIL — `Cannot find module '../electron/services/agent.title'` (or similar resolution error), since the file doesn't exist yet.

- [ ] **Step 4: Implement `agent.title.ts`**

Create `nexra/electron/services/agent.title.ts`:

```ts
import { generateText } from 'ai'
import type { AgentTitleRequest } from './agent.types'
import { resolveModel, type ProviderConfig } from './providers'

function systemPrompt(engagementType: string): string {
  return (
    `Generate a short title (3-6 words) summarizing what this ${engagementType} ` +
    `security-consulting chat will be about, based on the user's first message. ` +
    `Title Case, no quotes, no trailing punctuation, no explanation — respond with only the title.`
  )
}

// One short completion, not a chat turn — auto-titles a new chat from its
// first user message. Errors (missing key, network, provider) propagate to
// the caller, which falls back to a deterministic heuristic (see ipc.ts).
export async function runTitle(req: AgentTitleRequest, cfg: ProviderConfig): Promise<string> {
  const model = resolveModel(cfg)
  const { text } = await generateText({
    model,
    system: systemPrompt(req.engagementType),
    messages: [{ role: 'user', content: req.text }],
    maxOutputTokens: 20,
  })
  return text.trim().replace(/^["']+|["']+$/g, '').slice(0, 48)
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd nexra && npx vitest run test/agent.title.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add nexra/electron/services/agent.types.ts nexra/electron/services/agent.title.ts nexra/test/agent.title.test.ts
git commit -m "feat(agent): add cheap-model title generation service"
```

---

### Task 2: Wire `agent:title` over IPC

**Files:**
- Modify: `nexra/electron/main.ts:1-9,64-72`
- Modify: `nexra/electron/preload.ts:11-15`
- Modify: `nexra/src/global.d.ts`

**Interfaces:**
- Consumes: `runTitle(req: AgentTitleRequest, cfg: ProviderConfig): Promise<string>` (Task 1); `loadConfig(): ProviderConfig` (existing, `main.ts:50-58`, unchanged).
- Produces: `window.nexra.agent.title(req: AgentTitleRequest): Promise<string>` — Task 4 calls this from `sendMessage()`.

No test file: this is IPC plumbing with no branching logic and the codebase has no existing tests for `main.ts`/`preload.ts` (only reducer, `agent.live`, and `providers` are unit-tested). Verified instead via a full TypeScript build.

- [ ] **Step 1: Add the IPC handler in `main.ts`**

In `nexra/electron/main.ts`, add the import alongside the existing `runSend` import (line 5):

```ts
import { runSend } from './services/agent.live'
import { runTitle } from './services/agent.title'
```

Then add a new handler immediately after the existing `agent:send` handler (after the closing `})` of `ipcMain.handle('agent:send', ...)`, before `ipcMain.handle('agent:cancel', ...)`):

```ts
  ipcMain.handle('agent:title', (_ev, req) => runTitle(req, loadConfig()))
```

- [ ] **Step 2: Expose it on the `window.nexra` bridge in `preload.ts`**

In `nexra/electron/preload.ts`, inside the `agent: { ... }` object, add a `title` method alongside `send`/`install`/`cancel`:

```ts
  agent: {
    send: (req: any, onEvent: any) => { const ch = 'agent:event:' + req.chatId; const l = (_: any, e: any) => onEvent(e); ipcRenderer.on(ch, l); return ipcRenderer.invoke('agent:send', req).finally(() => ipcRenderer.removeListener(ch, l)) },
    title: (req: any) => ipcRenderer.invoke('agent:title', req),
    install: (req: any, onEvent: any) => { const ch = 'agent:event:' + req.chatId; const l = (_: any, e: any) => onEvent(e); ipcRenderer.on(ch, l); return ipcRenderer.invoke('agent:install', req).finally(() => ipcRenderer.removeListener(ch, l)) },
    cancel: (chatId: string) => ipcRenderer.invoke('agent:cancel', chatId),
  },
```

- [ ] **Step 3: Type the bridge method in `global.d.ts`**

In `nexra/src/global.d.ts`, add `AgentTitleRequest` to the type-only import from `agent.types`:

```ts
import type { AgentEvent, AgentSendRequest, AgentInstallRequest, AgentTitleRequest } from '../electron/services/agent.types'
```

Then add `title` to the `agent` interface member:

```ts
  agent: {
    send(req: AgentSendRequest, onEvent: (e: AgentEvent) => void): Promise<void>
    title(req: AgentTitleRequest): Promise<string>
    install(req: AgentInstallRequest, onEvent: (e: AgentEvent) => void): Promise<void>
    cancel(chatId: string): Promise<void>
  }
```

- [ ] **Step 4: Verify the build compiles**

Run: `cd nexra && npm run build`
Expected: succeeds with no TypeScript errors (confirms `main.ts`, `preload.ts`, and `global.d.ts` all agree on the new `AgentTitleRequest`/`agent.title` shapes).

- [ ] **Step 5: Commit**

```bash
git add nexra/electron/main.ts nexra/electron/preload.ts nexra/src/global.d.ts
git commit -m "feat(ipc): wire agent:title channel over the nexra bridge"
```

---

### Task 3: `setChatTitle` reducer action

**Files:**
- Modify: `nexra/src/state/reducer.ts:10-17,84,176-188`
- Modify: `nexra/test/reducer.test.ts:125-155`

**Interfaces:**
- Consumes: none new.
- Produces: `{ t: 'setChatTitle'; chatId: string; title: string }` action, handled by the reducer — sets `chat.name` only if it's still `'New chat'`. Task 4's `sendMessage()` dispatches this.
- `deriveTitle(text: string): string` (existing, unchanged signature) — role changes from "M1 stand-in" to "fallback for a failed live call"; still exported for Task 4 to use.

- [ ] **Step 1: Write the failing/updated tests**

In `nexra/test/reducer.test.ts`, replace the three tests from `'titles a provisional chat and infers focus from the first message'` through `'only titles on the first user message'` (current lines 125–155) with:

```ts
  it('infers focus from the first message; title stays provisional pending the live call', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const engId = activeEngagement(s)!.id
    s = reducer(s, { t: 'createChat', engId })
    const chatId = activeChat(s)!.id
    s = reducer(s, { t: 'appendUserMessage', chatId, text: 'review iam roles for privilege escalation' })
    const chat = chatByGlobalId(s, chatId)!
    expect(chat.name).toBe('New chat')
    expect(chat.phaseId).toBe('iam')
  })
  it('setChatTitle sets the title on a still-provisional chat', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const engId = activeEngagement(s)!.id
    s = reducer(s, { t: 'createChat', engId })
    const chatId = activeChat(s)!.id
    s = reducer(s, { t: 'setChatTitle', chatId, title: 'Review IAM Privilege Escalation' })
    expect(chatByGlobalId(s, chatId)!.name).toBe('Review IAM Privilege Escalation')
  })
  it('setChatTitle does not override a chat the user already renamed', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    s = reducer(s, { t: 'startRename' })
    s = reducer(s, { t: 'setNameDraft', value: 'My audit' })
    s = reducer(s, { t: 'saveName' })
    const chatId = activeChat(s)!.id
    s = reducer(s, { t: 'setChatTitle', chatId, title: 'Some generated title' })
    expect(chatByGlobalId(s, chatId)!.name).toBe('My audit')
  })
```

Leave the earlier `deriveTitle`/`inferFocus` unit tests (current lines 113–124) untouched.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd nexra && npx vitest run test/reducer.test.ts`
Expected: FAIL — the first new test fails because `appendUserMessage` still sets `chat.name` via `deriveTitle` (so `chat.name` won't be `'New chat'`); the second and third fail with `Object literal may only specify known properties` / a runtime no-op, since `'setChatTitle'` isn't a handled action yet (falls through to `default: return state`, so `chat.name` stays `'New chat'` instead of the expected value in test 2).

- [ ] **Step 3: Update `reducer.ts`**

In `nexra/src/state/reducer.ts`, update the comment above `deriveTitle` (lines 10-11):

```ts
// Fallback title when the live cheap-model call (see agent.title.ts) fails —
// derives a short title from the user's first question. Pure/deterministic.
export function deriveTitle(text: string): string {
```

Add the new action to the `Action` union, right after `appendUserMessage` (line 84):

```ts
  | { t: 'appendUserMessage'; chatId: string; text: string }
  | { t: 'setChatTitle'; chatId: string; title: string }
```

Replace the `appendUserMessage` case body (lines 176-188) with:

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
    case 'setChatTitle': {
      const c = chatByGlobalId(s, a.chatId); if (!c) return state
      if (c.name === 'New chat') c.name = a.title
      return s
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd nexra && npx vitest run test/reducer.test.ts`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
git add nexra/src/state/reducer.ts nexra/test/reducer.test.ts
git commit -m "feat(reducer): add setChatTitle action, stop synchronous title mock"
```

---

### Task 4: Fire the title call from `sendMessage`

**Files:**
- Modify: `nexra/src/ipc.ts:1-5,58-80`
- Create: `nexra/test/ipc.test.ts`

**Interfaces:**
- Consumes: `window.nexra.agent.title(req: AgentTitleRequest): Promise<string>` (Task 2); `{ t: 'setChatTitle'; chatId; title }` action (Task 3); `deriveTitle(text: string): string` (existing, Task 3 updated its doc comment only — signature unchanged).
- Produces: none for later tasks — this is the last task.

- [ ] **Step 1: Write the failing test**

Create `nexra/test/ipc.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendMessage } from '../src/ipc'
import type { Chat, Engagement } from '../electron/services/store.types'

const send = vi.fn()
const title = vi.fn()

beforeEach(() => {
  send.mockReset().mockResolvedValue(undefined)
  title.mockReset()
  ;(window as any).nexra = { agent: { send, title } }
})

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'c1', name: 'New chat', phaseId: '', color: '#000',
    messages: [{ id: 'm1', role: 'assistant', kind: 'text', content: 'hi' }],
    findings: [], tools: [], ...overrides,
  }
}

const eng: Engagement = {
  id: 'e1', type: 'aws', name: 'Eng 1', status: 'In Progress',
  updated: '2026-01-01', linear: true, phases: [{ id: 'p1', label: 'Discovery' }], scope: [], chats: [],
}

describe('sendMessage title generation', () => {
  it('fires agent.title on the first user message of a provisional chat', () => {
    const dispatch = vi.fn()
    title.mockResolvedValue('Review IAM Roles')
    sendMessage(dispatch, makeChat(), eng, 'review iam roles')
    expect(title).toHaveBeenCalledWith({ engagementType: 'aws', text: 'review iam roles' })
  })

  it('dispatches setChatTitle with the resolved title on success', async () => {
    const dispatch = vi.fn()
    title.mockResolvedValue('Review IAM Roles')
    sendMessage(dispatch, makeChat(), eng, 'review iam roles')
    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith({ t: 'setChatTitle', chatId: 'c1', title: 'Review IAM Roles' })
    })
  })

  it('falls back to deriveTitle when the title call rejects', async () => {
    const dispatch = vi.fn()
    title.mockRejectedValue(new Error('no api key'))
    sendMessage(dispatch, makeChat(), eng, 'look at storage buckets')
    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith({ t: 'setChatTitle', chatId: 'c1', title: 'Look at storage buckets' })
    })
  })

  it('does not fire agent.title on a chat the user already renamed', () => {
    const dispatch = vi.fn()
    sendMessage(dispatch, makeChat({ name: 'My audit' }), eng, 'hello')
    expect(title).not.toHaveBeenCalled()
  })

  it('does not fire agent.title on a second message', () => {
    const dispatch = vi.fn()
    const chat = makeChat({
      messages: [
        { id: 'm1', role: 'assistant', kind: 'text', content: 'hi' },
        { id: 'm2', role: 'user', kind: 'text', content: 'first' },
        { id: 'm3', role: 'assistant', kind: 'text', content: 'reply' },
      ],
    })
    sendMessage(dispatch, chat, eng, 'second message')
    expect(title).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd nexra && npx vitest run test/ipc.test.ts`
Expected: FAIL — the first three tests fail because `sendMessage` never calls `window.nexra.agent.title` yet (`title` mock has 0 calls).

- [ ] **Step 3: Update `ipc.ts`**

In `nexra/src/ipc.ts`, change the import of `Action` (line 4) to also import `deriveTitle` as a value:

```ts
import { deriveTitle, type Action } from './state/reducer'
```

Replace the `sendMessage` function (lines 58-80) with:

```ts
export function sendMessage(dispatch: Dispatch<Action>, chat: Chat, eng: Engagement, text: string): void {
  const trimmed = text.trim()
  if (!trimmed) return
  const history = chat.messages
    .filter(m => m.kind === 'text' && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content as string }))
  const isFirstUserMessage = !chat.messages.some(m => m.role === 'user')
  const isProvisional = chat.name === 'New chat'
  dispatch({ t: 'appendUserMessage', chatId: chat.id, text: trimmed })
  dispatch({ t: 'setStreaming', chatId: chat.id, on: true })
  const primaryTool = chat.tools.find(t => t.available)?.name ?? 'shell'
  const runningIds = new Map<string, string>()
  window.nexra.agent.send(
    { chatId: chat.id, engagementType: eng.type, phaseLabel: phaseLabel(eng, chat.phaseId), primaryTool, text: trimmed, history },
    applyEvent(dispatch, chat.id, runningIds),
  ).catch((err: unknown) => {
    // Only fires when the IPC invoke promise genuinely rejects with no terminal
    // error/done event delivered (e.g. an upstream main-process throw). On the
    // normal path runSend emits error/done and the promise resolves, so this
    // does not double-report. Without it a reject would leave the chat stuck
    // streaming forever with a locked composer and no user recovery.
    dispatch({ t: 'appendError', chatId: chat.id, message: err instanceof Error ? err.message : 'Request failed to start' })
    dispatch({ t: 'setStreaming', chatId: chat.id, on: false })
  })
  // Fire-and-forget: runs concurrently with the reply above, never blocks or
  // delays it. Falls back to the deterministic heuristic on any failure (no
  // key, network error, provider error) so the chat is never stuck untitled.
  if (isFirstUserMessage && isProvisional) {
    window.nexra.agent.title({ engagementType: eng.type, text: trimmed })
      .then(title => dispatch({ t: 'setChatTitle', chatId: chat.id, title }))
      .catch(() => dispatch({ t: 'setChatTitle', chatId: chat.id, title: deriveTitle(trimmed) }))
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd nexra && npx vitest run test/ipc.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the full test suite**

Run: `cd nexra && npm test`
Expected: all tests pass (existing suite + the new `agent.title.test.ts`, updated `reducer.test.ts`, and new `ipc.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add nexra/src/ipc.ts nexra/test/ipc.test.ts
git commit -m "feat(chat): fire live title generation on the first user message"
```
