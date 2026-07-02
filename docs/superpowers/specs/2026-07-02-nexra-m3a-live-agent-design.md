# Nexra.sh — M3a (Live Conversational Agent) Design

**Date:** 2026-07-02
**Status:** Approved (design), pending implementation plan
**Scope:** M3a — the foundation slice of M3 in
`docs/superpowers/specs/2026-07-02-nexra-internal-usable-plan.md`.
**Prereqs:** M1 (UI shell) + M2 (real terminals) complete and merged.

## 1. Goal

Replace the mock `AgentService` with a **live, streaming conversational agent**
and make **Settings real**. After M3a a chat is a genuine LLM conversation —
Claude (Anthropic, cloud) or a local Ollama model — that streams tokens live,
can be interrupted mid-response, remembers the conversation, and reads its
provider/model/key from persisted settings.

**Explicitly NOT in M3a** (later milestones): the agent executing tools /
driving the shell (M3b); engagement/message/finding persistence and external
memory (M4); OpenAI and Google providers; dynamic Ollama model discovery. M3a
is conversation only — the "Shared with agent" execution story is M3b.

## 2. Decisions locked during brainstorming (2026-07-02)

- **AI SDK v5 (stable), not v6.** v6 is still `6.0.0-beta.x`. v5 already provides
  everything M3a needs (`streamText` with `abortSignal`/`onAbort`, `textStream`
  delta iteration). The `streamText` surface is stable across v5→v6, so a later
  bump is low-cost. This is a deliberate deviation from the "v6" named in
  `CLAUDE.md`/HANDOVER (which was a forward guess made before v6 existed).
- **Two providers wired live: Anthropic + Ollama.** Anthropic = cloud, needs an
  API key. Ollama = local, needs a base URL and no key. These two exercise both
  provider shapes and give an air-gapped/local-inference option for sensitive
  engagements. OpenAI/Google remain selectable-but-inert, added later.
- **Ollama via the OpenAI-compatible provider.** Ollama exposes an
  OpenAI-compatible API at `/v1`, so `@ai-sdk/openai-compatible`
  (`createOpenAICompatible({ name:'ollama', baseURL })`) is used — no
  third-party Ollama package.
- **Live token streaming** (not buffered) — requires a small `AgentEvent`
  addition (below).
- **SQLite pulled forward, scoped to settings only.** `better-sqlite3` stands
  up now as the persistence substrate, but M3a persists **only app settings**.
  Engagement data still comes from the in-memory seed until M4.

## 3. Architecture

The agent runs in the **main process** (like node-pty): it holds the API key,
constructs provider clients, and streams to the renderer over the existing
`agent:event:<chatId>` channel. **The API key never crosses the IPC boundary to
the renderer.**

New / changed files under `nexra/electron/services/`:

- **`agent.live.ts`** — replaces `agent.mock.ts`. `runSend(req, emit, signal)`
  builds the system prompt + messages, resolves the model via `providers.ts`,
  calls AI SDK `streamText`, and translates the stream into `AgentEvent`s.
  (`runInstall` from the mock is dropped — tool install is an M3b concern; see
  §9.)
- **`providers.ts`** — pure-ish factory. `resolveModel(cfg, apiKey?)` returns an
  AI SDK `LanguageModel`:
  - `anthropic` → `createAnthropic({ apiKey })(model)` from `@ai-sdk/anthropic`.
  - `ollama` → `createOpenAICompatible({ name:'ollama', baseURL })(model)` from
    `@ai-sdk/openai-compatible`.
- **`store.sqlite.ts`** — `better-sqlite3`-backed `StoreService`. M3a surface:
  DB bootstrap in `app.getPath('userData')`, a migration runner, and a
  `settings` key/value table with `getSetting`/`setSetting`. `snapshot()` still
  returns the in-memory seed (`buildSnapshot`) — engagement persistence is M4.
- **`secrets.ts`** — Electron `safeStorage`. `encryptSecret(plain) → Buffer`
  (ciphertext) and `decryptSecret(buf) → string`. The ciphertext blob is stored
  in the `settings` table; the plaintext key lives only transiently in main when
  building a provider.

Renderer changes are confined to: `src/ipc.ts` (event translation + new cancel
call + history assembly), `src/components/Settings.tsx` (real load/save),
`src/components/Composer.tsx` (busy-lock + Stop), and the reducer/`UIState`
(streaming state + two new event actions). **No renderer component imports a
service** — everything stays behind `window.nexra.*`.

## 4. Data flow

### Send + stream

1. Renderer `sendMessage()` (`src/ipc.ts`) calls
   `window.nexra.agent.send(req, onEvent)`. `AgentSendRequest` gains a
   **`history: { role: 'user' | 'assistant'; content: string }[]`** field — a
   provider-neutral shape (the renderer never imports an AI SDK type; main maps
   it to the SDK's `ModelMessage`). It is the chat's prior messages from the
   reducer (user→user, assistant text→assistant; `kind:'tool'` messages are
   skipped in M3a since none are real yet). The reducer is the source of truth
   for history, so it rides along each turn (no conversation persistence needed
   in M3a).
2. Main (`agent:send` handler) builds a **system prompt** from
   `engagementType` + `phaseLabel` (a security-consultant role scoped to the
   phase; advisory only — no tools). It resolves provider config from SQLite +
   the decrypted key, gets a model from `providers.ts`, and calls:
   ```ts
   streamText({ model, system, messages: [...history, userMessage], abortSignal })
   ```
3. Main iterates `result.textStream`, emitting `{ type:'text_delta', delta }`
   per chunk; on natural completion emits `{ type:'done' }` (optionally carrying
   `result.usage`).

### Cancel / interrupt

- New IPC channel **`agent:cancel`** + `window.nexra.agent.cancel(chatId)` in the
  preload.
- Main holds a `Map<chatId, AbortController>` for in-flight streams. `cancel`
  aborts the controller for that chat; `streamText`'s `onAbort` finalizes —
  the partial assistant message is **kept and marked interrupted**, and a `done`
  is emitted so the renderer clears busy state.

## 5. `AgentEvent` contract change

Add two variants to the union in `agent.types.ts`; keep the rest for M3b:

```ts
| { type: 'text_delta'; delta: string }      // NEW — streaming assistant text
| { type: 'error'; message: string }         // NEW — surfaced failure
```

- `text_delta` → reducer appends to the **in-progress assistant message**,
  creating it on the first delta of a turn. This replaces the mock's
  whole-message `text` for live output.
- `error` → reducer appends an error/system message and clears the chat's busy
  state.

`text`, `tool_call`, `finding` remain in the union. `tool_call`/`finding` are
unused until M3b; `text` is retained for any non-streamed system line.
`src/ipc.ts:applyEvent` gains handlers for `text_delta` and `error`.

### Reducer / `UIState`

- New action `appendTextDelta { chatId, delta }` — find-or-create the trailing
  assistant message on that chat and append to its `content`. (Contrast with the
  existing `appendText`, which pushes a whole new message.)
- New action `appendError { chatId, message }` — push a system/error message.
- New action(s) to set/clear streaming state.
- `UIState` gains **`streamingChats: Record<string, true>`** (keyed by
  `chatId`) — chats stream independently, so busy state is per-chat, not global.

## 6. Settings + secrets

`src/components/Settings.tsx` becomes real (currently all `useState`, saved
nowhere):

- **On open:** load persisted `provider`, `model`, `baseURL`, and a boolean
  "key is set" flag from SQLite (via `window.nexra.store`/a settings IPC).
- **On change / Done:** persist `provider`/`model`/`baseURL`. The API key, when
  entered, is sent to main **once**, encrypted with `safeStorage`, and stored as
  ciphertext. The key is **never read back** into the renderer — the field shows
  a "key is set — replace?" state, not the stored value.
- Anthropic path uses the key + the existing model dropdown
  (`claude-opus-4-8` / `claude-sonnet-5` / `claude-haiku-4-5`). Ollama path uses
  `baseURL` (default `http://localhost:11434`, `/v1` appended in `providers.ts`)
  and a **free-text model** field (whatever the user has pulled locally) rather
  than a single hardcoded entry.

New settings IPC (thin, behind `window.nexra`): `getSettings()`,
`setSettings(partial)`, `setApiKey(provider, plaintext)`, `hasApiKey(provider)`.
`setApiKey` is the only path plaintext key material travels, and only
renderer→main.

## 7. Concurrency / busy-lock

Closes the handover's "no guard against overlapping agent streams" gap.

- While a chat is streaming, its entry in `ui.streamingChats` is set. The
  `Composer` for that chat **disables Send** and shows a **Stop** button wired to
  `window.nexra.agent.cancel(chatId)`.
- A second send to an already-streaming chat is blocked at the composer. Sends to
  *other* chats are unaffected (per-chat state).

## 8. Error handling

Every failure surfaces as an `error` event → a visible chat message, busy
cleared, safe to retry. Covered cases:

- Missing/invalid API key (401) → "No API key set for Anthropic — add one in
  Settings" / "Anthropic rejected the API key".
- Network failure / timeout.
- Ollama not running / unreachable base URL → "Couldn't reach Ollama at
  `<baseURL>` — is it running?".
- Rate limit (429) / provider 5xx.
- Abort is **not** an error — it finalizes cleanly (§4).

No silent failures; no unhandled promise rejections in main.

## 9. Dropped mock behavior

The mock's `runInstall` + the tool-install flow (`agent.install` IPC,
`markToolAvailable`, the "Install" tool-card action) depend on real tool
execution and are an **M3b** concern. Explicit M3a decision: the `agent:install`
handler becomes an **informational no-op** — it emits a single `error` event
("Tool install arrives with agent execution in M3b") and does **not** flip
`available`. The renderer's Install button and `markToolAvailable` action stay
in place (reachable via seeded unavailable tools) but now surface that message
instead of a fake success. This keeps the build green and the UI honest without
pretending install works.

## 10. Risks

- **`better-sqlite3` × Electron ABI** — a native module, like node-pty. M2's
  lesson: verify it **loads under Electron's Node ABI and under Vitest's plain
  Node** before building on it. First implementation task is a load/roundtrip
  spike; if a rebuild step is needed (`@electron/rebuild`), it's wired into
  `postinstall` alongside the existing node-pty permission fix.
- **`safeStorage` availability** — Keychain (macOS) / DPAPI (Windows) are solid
  for our targets. Guard the Linux/dev fallback (safeStorage can report
  unavailable) with a clear error rather than storing plaintext.
- **Secret hygiene** — the decrypted key must not leak into `process.env` in a
  way that reaches the operator shells (standing warning at
  `shell.pty.ts:35`); it stays a local variable in `agent.live.ts`.

## 11. Testing

Unit / integration (Vitest), mirroring M2's split of pure logic vs. real
native/integration:

- **`providers.ts`** — config → correct model construction (Anthropic vs Ollama
  base URL), mocked SDK.
- **`agent.live.ts`** — stream→event mapping: a fake `streamText` yielding known
  deltas produces the expected `text_delta*` then `done`; an error path yields
  `error`; an aborted stream finalizes (kept partial + `done`).
- **Reducer** — `appendTextDelta` (find-or-create trailing assistant message,
  concatenation), `appendError`, streaming set/clear.
- **SQLite `store.sqlite.ts`** — settings round-trip + migration runs on a fresh
  DB (temp file).
- **`secrets.ts`** — encrypt→decrypt round-trip with `safeStorage` mocked;
  unavailable-safeStorage path errors, doesn't fall back to plaintext.
- **Full renderer↔IPC round-trip** (currently untested per the M3-seam recon):
  `agent.send` → events → `applyEvent` → reducer state, with a fake main-side
  agent; and `agent.cancel` aborts.
- **Settings** — load persisted values on open; save on change; key stored via
  `setApiKey` never returned by `getSettings`/`hasApiKey`.

`tsc --noEmit` + `npm run build` clean; all prior tests still green.

## 12. Acceptance

- With a valid Anthropic key in Settings, sending a message in a chat streams a
  real Claude response token-by-token; the chat remembers prior turns.
- Switching the provider to Ollama (with Ollama running locally) streams from a
  local model, no key required.
- Pressing Stop mid-response halts the stream, keeps the partial text, and
  re-enables the composer.
- Provider/model/baseURL survive an app restart; the API key survives a restart
  (from the OS keychain) and is never shown back in the UI.
- Bad key / Ollama-down produce a clear in-chat error, not a hang or crash.
- Two chats can stream independently; a chat mid-stream blocks a second send to
  itself only.

## 13. New dependencies

- `ai` (v5 stable) — core SDK.
- `@ai-sdk/anthropic` — Claude provider.
- `@ai-sdk/openai-compatible` — Ollama (local) provider.
- `better-sqlite3` (+ types) — settings persistence substrate.
- (Electron `safeStorage` is built in — no dependency.)

## 14. Process & references

Built with the locked process: this spec → `superpowers:writing-plans` →
`superpowers:subagent-driven-development` → merge.

- Milestone plan: `docs/superpowers/specs/2026-07-02-nexra-internal-usable-plan.md`
- Competitive requirements: `docs/superpowers/specs/2026-07-02-competitive-requirements.md`
- M0/M2 spec: `docs/superpowers/specs/2026-07-01-redcell-m0-m2-design.md`
- Current handover: `docs/superpowers/HANDOVER.md`
- App: `nexra/`
