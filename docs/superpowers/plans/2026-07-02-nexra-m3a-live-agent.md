# Nexra M3a (Live Conversational Agent) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mock `AgentService` with a live, streaming Claude/Ollama agent and make Settings real (SQLite-persisted config + OS-keychain-encrypted API key), with per-chat interrupt and a composer busy-lock.

**Architecture:** The agent runs in the Electron **main process** using the Vercel AI SDK v5 `streamText`. It streams token deltas to the renderer over the existing `agent:event:<chatId>` channel; a new `agent:cancel` channel aborts an in-flight stream. App settings persist in a `better-sqlite3` database (settings table only — engagement data stays seeded); the API key is encrypted with Electron `safeStorage` and never returned to the renderer. No renderer component imports a service — everything flows through `window.nexra.*`.

**Tech Stack:** Electron 31, TypeScript, React 18, Vite 5, Vitest 2. New: `ai` (v5), `@ai-sdk/anthropic`, `@ai-sdk/openai-compatible`, `better-sqlite3`. Electron `safeStorage` (built in).

## Global Constraints

- **Platforms:** macOS (arm64 + x64) and Windows. Tests run under Vitest (plain Node) on both.
- **AI SDK v5 stable** — install `ai@^5`, NOT the `6.0.0-beta.x` line. The `streamText` surface used here (`abortSignal`, `onAbort`, `textStream`) is v5.
- **Providers wired live: Anthropic + Ollama only.** OpenAI/Google stay selectable-but-inert. Anthropic uses an API key; Ollama uses `@ai-sdk/openai-compatible` against `baseUrl + '/v1'` with no key.
- **Anthropic model IDs (verbatim):** `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5`. Default `claude-opus-4-8`.
- **Ollama default base URL:** `http://localhost:11434` (the `/v1` suffix is appended in `providers.ts`, never stored with it).
- **API key handling:** encrypted via `safeStorage`, stored as base64 ciphertext in the settings DB under key `secret.apikey.<provider>`, decrypted only transiently in main when building a provider. It is NEVER sent to the renderer and NEVER placed in `process.env` (keep it out of the operator shells — see `electron/services/shell.pty.ts:35`).
- **SQLite scope:** settings only. `store:snapshot` still returns the in-memory seed via `store.mock.ts`. Engagement/message/finding persistence is M4, not here.
- **AgentEvent union:** ADD `text_delta` and `error`; KEEP `text`, `tool_call`, `finding`, `done`. Do not remove existing variants or the `appendText` action.
- **Electron security unchanged:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`.
- **UI fidelity:** `Composer.tsx` and `Settings.tsx` already exist and are pixel-ported. Preserve every existing hex/px value; only add the new busy/Stop and load/save behavior.
- TDD, DRY, YAGNI, one commit per task.

## File Structure

**Create:**
- `nexra/electron/services/store.sqlite.ts` — better-sqlite3 settings store (init, migrations, get/set).
- `nexra/electron/services/secrets.ts` — safeStorage encrypt/decrypt.
- `nexra/electron/services/providers.ts` — `ProviderConfig` type + `resolveModel()`.
- `nexra/electron/services/agent.live.ts` — `runSend()` streaming agent.
- Tests: `store.sqlite.native.test.ts`, `store.sqlite.test.ts`, `secrets.test.ts`, `providers.test.ts`, `agent.live.test.ts`, `ipc.test.ts`, `Composer.test.tsx`, `Settings.test.tsx`.

**Modify:**
- `nexra/electron/services/agent.types.ts` — new events + `history` on `AgentSendRequest`.
- `nexra/electron/main.ts` — swap mock→live, AbortController map, cancel/install/settings/secret IPC, DB init.
- `nexra/electron/preload.ts` — `agent.cancel`, `settings` bridge.
- `nexra/src/global.d.ts` — `NexraApi` additions.
- `nexra/src/ipc.ts` — history + streaming + `text_delta`/`error`/cancel + settings client.
- `nexra/src/state/types.ts` — `streamingChats` on `UIState`.
- `nexra/src/state/reducer.ts` — `initialUI` + `appendTextDelta`/`appendError`/`setStreaming` actions.
- `nexra/src/components/Composer.tsx` — busy-lock + Stop button.
- `nexra/src/components/ChatPane.tsx` — pass busy + onStop.
- `nexra/src/components/Settings.tsx` — real load/save.
- `nexra/vite.config.ts` — externalize `better-sqlite3`.
- `nexra/package.json`, `nexra/scripts/fix-native-permissions.cjs` — deps + rebuild.

**Delete (Task 8):** `nexra/electron/services/agent.mock.ts`, `nexra/test/agent.mock.test.ts`.

---

## Task 1: Dependencies + SQLite native-load spike

**Files:**
- Modify: `nexra/package.json`, `nexra/vite.config.ts`, `nexra/scripts/fix-native-permissions.cjs`
- Test: `nexra/test/store.sqlite.native.test.ts`

**Interfaces:**
- Produces: the four runtime deps + `better-sqlite3` importable under Vitest and externalized in the Electron build.

- [ ] **Step 1: Install dependencies**

Run from `nexra/`:
```bash
npm install ai@^5 @ai-sdk/anthropic @ai-sdk/openai-compatible better-sqlite3
npm install -D @types/better-sqlite3 @electron/rebuild
```
Expected: `ai` resolves to a `5.x` version (verify `npm ls ai` shows `5.`), not `6.0.0-beta`.

- [ ] **Step 2: Externalize better-sqlite3 in the Electron main build**

In `nexra/vite.config.ts`, change the main entry's external array to include `better-sqlite3`:
```ts
{ entry: 'electron/main.ts', vite: { build: { rollupOptions: { external: ['node-pty', 'better-sqlite3'] } } } },
```

- [ ] **Step 3: Rebuild better-sqlite3 for Electron's ABI in postinstall**

`better-sqlite3` compiles against V8 headers (unlike node-pty's N-API prebuild), so it needs an Electron-targeted rebuild. Append to `nexra/scripts/fix-native-permissions.cjs` (which already runs at postinstall) a step that shells out to electron-rebuild for ONLY better-sqlite3 (leaving node-pty's working prebuild untouched):
```js
// Rebuild better-sqlite3 against Electron's ABI (it is not N-API-prebuilt like
// node-pty). Scoped with --only so node-pty's prebuilt binary is left alone.
const { execSync } = require('node:child_process')
try {
  execSync('npx --no-install electron-rebuild --only better-sqlite3', { stdio: 'inherit', cwd: __dirname + '/..' })
} catch (e) {
  console.warn('[fix-native] electron-rebuild for better-sqlite3 failed:', e.message)
}
```

- [ ] **Step 4: Write the failing native-load test**

Create `nexra/test/store.sqlite.native.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'

describe('better-sqlite3 native module', () => {
  it('opens an in-memory db and round-trips a row', () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE t (k TEXT PRIMARY KEY, v TEXT)')
    db.prepare('INSERT INTO t (k, v) VALUES (?, ?)').run('a', '1')
    const row = db.prepare('SELECT v FROM t WHERE k = ?').get('a') as { v: string }
    expect(row.v).toBe('1')
    db.close()
  })
})
```

- [ ] **Step 5: Run the test to verify it passes (module loads under Vitest's Node)**

Run: `npm test -- store.sqlite.native`
Expected: PASS. If it fails to load the native binding, resolve before continuing (this is the ABI spike).

- [ ] **Step 6: Manual Electron-ABI check (documented, not automated)**

Run: `npm run build` — Expected: clean (better-sqlite3 externalized, not bundled).
Note for the operator in the commit body: a full Electron-runtime load check happens the first time `npm run dev` opens the app in Task 8; if it throws `NODE_MODULE_VERSION` mismatch, re-run `npx electron-rebuild --only better-sqlite3`.

- [ ] **Step 7: Commit**
```bash
git add package.json package-lock.json vite.config.ts scripts/fix-native-permissions.cjs test/store.sqlite.native.test.ts
git commit -m "chore(m3a): add AI SDK v5 + better-sqlite3 deps, externalize + ABI spike"
```

---

## Task 2: SQLite settings store

**Files:**
- Create: `nexra/electron/services/store.sqlite.ts`
- Test: `nexra/test/store.sqlite.test.ts`

**Interfaces:**
- Produces:
  - `initSettingsDb(dbPath: string): void` — opens/creates the DB at `dbPath`, runs migrations. Idempotent.
  - `getSetting(key: string): string | undefined`
  - `setSetting(key: string, value: string): void`

- [ ] **Step 1: Write the failing test**

Create `nexra/test/store.sqlite.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initSettingsDb, getSetting, setSetting } from '../electron/services/store.sqlite'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-')) ; initSettingsDb(join(dir, 'nexra.db')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('settings store', () => {
  it('returns undefined for a missing key', () => {
    expect(getSetting('provider')).toBeUndefined()
  })
  it('round-trips a value', () => {
    setSetting('provider', 'anthropic')
    expect(getSetting('provider')).toBe('anthropic')
  })
  it('overwrites on repeat set', () => {
    setSetting('model', 'claude-opus-4-8')
    setSetting('model', 'claude-sonnet-5')
    expect(getSetting('model')).toBe('claude-sonnet-5')
  })
  it('re-initializing an existing db keeps data', () => {
    setSetting('provider', 'ollama')
    initSettingsDb(join(dir, 'nexra.db'))
    expect(getSetting('provider')).toBe('ollama')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- store.sqlite.test`
Expected: FAIL — cannot find module `store.sqlite` / exports undefined.

- [ ] **Step 3: Implement the store**

Create `nexra/electron/services/store.sqlite.ts`:
```ts
import Database from 'better-sqlite3'

let db: Database.Database | null = null

// Opens (creating if needed) the settings DB and ensures the schema exists.
// Idempotent: safe to call again on an already-initialized path.
export function initSettingsDb(dbPath: string): void {
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
}

function requireDb(): Database.Database {
  if (!db) throw new Error('settings db not initialized — call initSettingsDb first')
  return db
}

export function getSetting(key: string): string | undefined {
  const row = requireDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value
}

export function setSetting(key: string, value: string): void {
  requireDb().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- store.sqlite.test`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**
```bash
git add electron/services/store.sqlite.ts test/store.sqlite.test.ts
git commit -m "feat(m3a): better-sqlite3 settings store (key/value + migrations)"
```

---

## Task 3: Secrets (safeStorage) service

**Files:**
- Create: `nexra/electron/services/secrets.ts`
- Test: `nexra/test/secrets.test.ts`

**Interfaces:**
- Produces:
  - `encryptSecret(plain: string): string` — returns base64 ciphertext. Throws if encryption is unavailable (never returns plaintext).
  - `decryptSecret(b64: string): string`

- [ ] **Step 1: Write the failing test**

Create `nexra/test/secrets.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = { available: true }
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => state.available,
    // Reversible stand-in for the OS crypto: prefix-tag the bytes.
    encryptString: (s: string) => Buffer.from('enc:' + s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, ''),
  },
}))

import { encryptSecret, decryptSecret } from '../electron/services/secrets'

beforeEach(() => { state.available = true })

describe('secrets', () => {
  it('round-trips a secret via base64 ciphertext', () => {
    const blob = encryptSecret('sk-test-123')
    expect(blob).not.toContain('sk-test-123')          // not stored as plaintext
    expect(decryptSecret(blob)).toBe('sk-test-123')
  })
  it('throws (does not fall back to plaintext) when encryption is unavailable', () => {
    state.available = false
    expect(() => encryptSecret('sk-x')).toThrow(/unavailable/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- secrets`
Expected: FAIL — cannot find module `secrets`.

- [ ] **Step 3: Implement**

Create `nexra/electron/services/secrets.ts`:
```ts
import { safeStorage } from 'electron'

// Encrypts a secret with the OS keychain-backed key and returns base64
// ciphertext for storage. Refuses to operate (rather than store plaintext)
// when the platform has no secure storage available.
export function encryptSecret(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS secure storage is unavailable — cannot store secret')
  return safeStorage.encryptString(plain).toString('base64')
}

export function decryptSecret(b64: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS secure storage is unavailable — cannot read secret')
  return safeStorage.decryptString(Buffer.from(b64, 'base64'))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- secrets`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**
```bash
git add electron/services/secrets.ts test/secrets.test.ts
git commit -m "feat(m3a): safeStorage secret encrypt/decrypt (no plaintext fallback)"
```

---

## Task 4: Provider factory

**Files:**
- Create: `nexra/electron/services/providers.ts`
- Test: `nexra/test/providers.test.ts`

**Interfaces:**
- Produces:
  - `interface ProviderConfig { provider: 'anthropic' | 'ollama' | 'openai' | 'google'; model: string; baseUrl?: string; apiKey?: string }`
  - `resolveModel(cfg: ProviderConfig): LanguageModel` — Anthropic via `createAnthropic({ apiKey })(model)`; Ollama via `createOpenAICompatible({ name: 'ollama', baseURL: cfg.baseUrl + '/v1' })(model)`. Throws `Error` for `openai`/`google` (not wired in M3a) and for `anthropic` with no `apiKey`.

- [ ] **Step 1: Write the failing test**

Create `nexra/test/providers.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'

const anthropicFactory = vi.fn((_opts: any) => vi.fn((model: string) => ({ tag: 'anthropic', model })))
const compatFactory = vi.fn((_opts: any) => vi.fn((model: string) => ({ tag: 'ollama', model })))
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: (o: any) => anthropicFactory(o) }))
vi.mock('@ai-sdk/openai-compatible', () => ({ createOpenAICompatible: (o: any) => compatFactory(o) }))

import { resolveModel } from '../electron/services/providers'

describe('resolveModel', () => {
  it('builds an Anthropic model with the api key', () => {
    const m = resolveModel({ provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'sk-1' }) as any
    expect(anthropicFactory).toHaveBeenCalledWith({ apiKey: 'sk-1' })
    expect(m).toEqual({ tag: 'anthropic', model: 'claude-opus-4-8' })
  })
  it('builds an Ollama model against baseUrl + /v1, no key', () => {
    const m = resolveModel({ provider: 'ollama', model: 'llama3.3', baseUrl: 'http://localhost:11434' }) as any
    expect(compatFactory).toHaveBeenCalledWith({ name: 'ollama', baseURL: 'http://localhost:11434/v1' })
    expect(m).toEqual({ tag: 'ollama', model: 'llama3.3' })
  })
  it('throws for anthropic with no key', () => {
    expect(() => resolveModel({ provider: 'anthropic', model: 'claude-opus-4-8' })).toThrow(/api key/i)
  })
  it('throws for a provider not wired in M3a', () => {
    expect(() => resolveModel({ provider: 'openai', model: 'gpt-5.1' })).toThrow(/not.*M3a|not wired/i)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- providers`
Expected: FAIL — cannot find module `providers`.

- [ ] **Step 3: Implement**

Create `nexra/electron/services/providers.ts`:
```ts
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

export interface ProviderConfig {
  provider: 'anthropic' | 'ollama' | 'openai' | 'google'
  model: string
  baseUrl?: string
  apiKey?: string
}

// Resolves runtime provider settings into an AI SDK model. M3a wires Anthropic
// (cloud, keyed) and Ollama (local, keyless, OpenAI-compatible at baseUrl/v1).
export function resolveModel(cfg: ProviderConfig): LanguageModel {
  if (cfg.provider === 'anthropic') {
    if (!cfg.apiKey) throw new Error('No API key set for Anthropic')
    return createAnthropic({ apiKey: cfg.apiKey })(cfg.model)
  }
  if (cfg.provider === 'ollama') {
    const baseURL = (cfg.baseUrl ?? 'http://localhost:11434') + '/v1'
    return createOpenAICompatible({ name: 'ollama', baseURL })(cfg.model)
  }
  throw new Error(`Provider "${cfg.provider}" is not wired in M3a`)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- providers`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**
```bash
git add electron/services/providers.ts test/providers.test.ts
git commit -m "feat(m3a): provider factory (Anthropic + Ollama via openai-compatible)"
```

---

## Task 5: AgentEvent contract + live streaming agent

**Files:**
- Modify: `nexra/electron/services/agent.types.ts`
- Create: `nexra/electron/services/agent.live.ts`
- Test: `nexra/test/agent.live.test.ts`

**Interfaces:**
- Consumes: `resolveModel`, `ProviderConfig` (Task 4).
- Produces:
  - `AgentEvent` gains `| { type: 'text_delta'; delta: string }` and `| { type: 'error'; message: string }`.
  - `AgentSendRequest` gains `history: { role: 'user' | 'assistant'; content: string }[]`.
  - `runSend(req: AgentSendRequest, cfg: ProviderConfig, emit: (e: AgentEvent) => void, signal: AbortSignal): Promise<void>` in `agent.live.ts`.

- [ ] **Step 1: Extend the event/request types**

In `nexra/electron/services/agent.types.ts`, update the union and request:
```ts
export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call'; state: ToolState; toolName: string; command?: string; output?: string; duration?: string; reason?: string; installCmd?: string }
  | { type: 'finding'; title: string; sev: Severity; phase: string; time: string }
  | { type: 'error'; message: string }
  | { type: 'done' }

export interface AgentSendRequest {
  chatId: string; engagementType: string; phaseLabel: string; primaryTool: string; text: string
  history: { role: 'user' | 'assistant'; content: string }[]
}
export interface AgentInstallRequest { chatId: string; toolName: string; installCmd?: string }
```

- [ ] **Step 2: Write the failing test**

Create `nexra/test/agent.live.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'

const streamText = vi.fn()
vi.mock('ai', () => ({ streamText: (o: any) => streamText(o) }))
vi.mock('../electron/services/providers', () => ({ resolveModel: () => ({ tag: 'fake-model' }) }))

import { runSend } from '../electron/services/agent.live'
import type { AgentEvent, AgentSendRequest } from '../electron/services/agent.types'
import type { ProviderConfig } from '../electron/services/providers'

const req: AgentSendRequest = { chatId: 'c1', engagementType: 'aws', phaseLabel: 'IAM', primaryTool: 'prowler', text: 'hi', history: [] }
const cfg: ProviderConfig = { provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'sk-1' }

function fakeStream(parts: string[]) {
  return { textStream: (async function* () { for (const p of parts) yield p })(), usage: Promise.resolve({ totalTokens: 3 }) }
}

describe('runSend', () => {
  it('emits a text_delta per chunk then done', async () => {
    streamText.mockReturnValue(fakeStream(['Hel', 'lo']))
    const events: AgentEvent[] = []
    await runSend(req, cfg, e => events.push(e), new AbortController().signal)
    expect(events).toEqual([
      { type: 'text_delta', delta: 'Hel' },
      { type: 'text_delta', delta: 'lo' },
      { type: 'done' },
    ])
  })
  it('emits error when the stream throws', async () => {
    streamText.mockReturnValue({ textStream: (async function* () { throw new Error('401 unauthorized') })(), usage: Promise.resolve({}) })
    const events: AgentEvent[] = []
    await runSend(req, cfg, e => events.push(e), new AbortController().signal)
    expect(events.some(e => e.type === 'error' && /401/.test(e.message))).toBe(true)
    expect(events.some(e => e.type === 'done')).toBe(false)
  })
  it('finalizes cleanly (done, no error) when aborted', async () => {
    const ctrl = new AbortController()
    streamText.mockReturnValue({ textStream: (async function* () { ctrl.abort(); throw Object.assign(new Error('aborted'), { name: 'AbortError' }) })(), usage: Promise.resolve({}) })
    const events: AgentEvent[] = []
    await runSend(req, cfg, e => events.push(e), ctrl.signal)
    expect(events.some(e => e.type === 'error')).toBe(false)
    expect(events[events.length - 1]).toEqual({ type: 'done' })
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- agent.live`
Expected: FAIL — cannot find module `agent.live`.

- [ ] **Step 4: Implement the live agent**

Create `nexra/electron/services/agent.live.ts`:
```ts
import { streamText } from 'ai'
import type { AgentEvent, AgentSendRequest } from './agent.types'
import { resolveModel, type ProviderConfig } from './providers'

function systemPrompt(engagementType: string, phaseLabel: string): string {
  const phase = phaseLabel ? ` Its current phase is: ${phaseLabel}.` : ''
  return (
    `You are Nexra, an AI assistant embedded in a security consultant's console, ` +
    `helping with a ${engagementType} engagement.${phase} ` +
    `Be precise and practical. You cannot execute tools yet — answer conversationally ` +
    `and help the consultant plan and interpret their work.`
  )
}

// Streams a live model response for one chat turn. Emits one text_delta per
// chunk, then done. On failure emits error (no done). An abort is not an error:
// it finalizes with done.
export async function runSend(
  req: AgentSendRequest,
  cfg: ProviderConfig,
  emit: (e: AgentEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  let model
  try {
    model = resolveModel(cfg)
  } catch (err) {
    emit({ type: 'error', message: (err as Error).message })
    return
  }
  const messages = [...req.history, { role: 'user' as const, content: req.text }]
  try {
    const result = streamText({ model, system: systemPrompt(req.engagementType, req.phaseLabel), messages, abortSignal: signal })
    for await (const delta of result.textStream) emit({ type: 'text_delta', delta })
    emit({ type: 'done' })
  } catch (err) {
    if (signal.aborted || (err as Error)?.name === 'AbortError') { emit({ type: 'done' }); return }
    emit({ type: 'error', message: (err as Error).message })
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- agent.live`
Expected: PASS (3 tests).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**
```bash
git add electron/services/agent.types.ts electron/services/agent.live.ts test/agent.live.test.ts
git commit -m "feat(m3a): live streaming agent + text_delta/error events + history"
```

---

## Task 6: Reducer — streaming state + delta/error actions

**Files:**
- Modify: `nexra/src/state/types.ts`, `nexra/src/state/reducer.ts`
- Test: `nexra/test/reducer.test.ts` (extend)

**Interfaces:**
- Produces new actions consumed by `ipc.ts` (Task 8):
  - `{ t: 'appendTextDelta'; chatId: string; delta: string }`
  - `{ t: 'appendError'; chatId: string; message: string }`
  - `{ t: 'setStreaming'; chatId: string; on: boolean }`
  - `UIState.streamingChats: Record<string, true>`

- [ ] **Step 1: Add `streamingChats` to UIState**

In `nexra/src/state/types.ts`, add to `UIState` (after `settingsOpen`):
```ts
  settingsOpen: boolean
  streamingChats: Record<string, true>
```

- [ ] **Step 2: Seed it in `initialUI` and deep-clone it**

In `nexra/src/state/reducer.ts`, add to `initialUI` (after `settingsOpen: false,`):
```ts
  settingsOpen: false,
  streamingChats: {},
```
And in `clone()`, extend the `ui` spread so the map is copied (change the `ui` object to include it):
```ts
ui: { ...s.ui, activeChatByEngagement: { ...s.ui.activeChatByEngagement }, ctxMenu: { ...s.ui.ctxMenu }, companyCtxMenu: { ...s.ui.companyCtxMenu }, streamingChats: { ...s.ui.streamingChats } }
```

- [ ] **Step 3: Write the failing tests**

Add to `nexra/test/reducer.test.ts` (import `reducer`, `initialUI` already present in that file's setup; a fresh state helper `mk()` that returns `{ data, ui }` should already exist — reuse it. If the file builds state via `buildSnapshot()`, use a chat id from the seed, e.g. the Acme IAM chat):
```ts
import { describe, it, expect } from 'vitest'
import { reducer } from '../src/state/reducer'
import { buildSnapshot } from '../electron/services/store.mock'
import { initialUI, initialActiveMap } from '../src/state/reducer'
import type { AppState } from '../src/state/selectors'

function baseState(): AppState {
  const data = buildSnapshot()
  const s: AppState = { data, ui: { ...initialUI } }
  s.ui.activeChatByEngagement = initialActiveMap(s)
  return s
}
function firstChatId(s: AppState): string {
  return s.data.companies[0].engagements[0].chats[0].id
}

describe('m3a streaming reducer actions', () => {
  it('appendTextDelta creates an assistant message then appends to it', () => {
    let s = baseState(); const id = firstChatId(s)
    const chat0 = s.data.companies[0].engagements[0].chats[0]
    const startCount = chat0.messages.length
    s = reducer(s, { t: 'appendUserMessage', chatId: id, text: 'hello' })
    s = reducer(s, { t: 'appendTextDelta', chatId: id, delta: 'Hel' })
    s = reducer(s, { t: 'appendTextDelta', chatId: id, delta: 'lo' })
    const msgs = s.data.companies[0].engagements[0].chats[0].messages
    const last = msgs[msgs.length - 1]
    expect(last.role).toBe('assistant')
    expect(last.content).toBe('Hello')
    // exactly one assistant message added for the two deltas (+1 user)
    expect(msgs.length).toBe(startCount + 2)
  })
  it('appendError pushes a system/error message', () => {
    let s = baseState(); const id = firstChatId(s)
    s = reducer(s, { t: 'appendError', chatId: id, message: 'boom' })
    const msgs = s.data.companies[0].engagements[0].chats[0].messages
    expect(msgs[msgs.length - 1].content).toContain('boom')
  })
  it('setStreaming toggles per-chat busy state', () => {
    let s = baseState(); const id = firstChatId(s)
    s = reducer(s, { t: 'setStreaming', chatId: id, on: true })
    expect(s.ui.streamingChats[id]).toBe(true)
    s = reducer(s, { t: 'setStreaming', chatId: id, on: false })
    expect(s.ui.streamingChats[id]).toBeUndefined()
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm test -- reducer`
Expected: FAIL — actions not handled / `streamingChats` undefined.

- [ ] **Step 5: Add the action types and handlers**

In `nexra/src/state/reducer.ts`, add to the `Action` union (after `markToolAvailable`):
```ts
  | { t: 'appendTextDelta'; chatId: string; delta: string }
  | { t: 'appendError'; chatId: string; message: string }
  | { t: 'setStreaming'; chatId: string; on: boolean }
```
Add handlers before `default:`:
```ts
    case 'appendTextDelta': {
      const c = chatByGlobalId(s, a.chatId); if (!c) return state
      const last = c.messages[c.messages.length - 1]
      if (last && last.role === 'assistant' && last.kind === 'text') last.content = (last.content ?? '') + a.delta
      else c.messages.push({ id: nextId('m'), role: 'assistant', kind: 'text', content: a.delta })
      return s
    }
    case 'appendError': {
      const c = chatByGlobalId(s, a.chatId); if (!c) return state
      c.messages.push({ id: nextId('m'), role: 'assistant', kind: 'text', content: '⚠ ' + a.message })
      return s
    }
    case 'setStreaming': {
      if (a.on) U.streamingChats[a.chatId] = true
      else delete U.streamingChats[a.chatId]
      return s
    }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- reducer`
Expected: PASS (existing + 3 new).

- [ ] **Step 7: Commit**
```bash
git add src/state/types.ts src/state/reducer.ts test/reducer.test.ts
git commit -m "feat(m3a): reducer streaming state + text-delta/error actions"
```

---

## Task 7: Preload + main IPC (live agent, cancel, settings/secret, DB init)

**Files:**
- Modify: `nexra/electron/preload.ts`, `nexra/electron/main.ts`, `nexra/src/global.d.ts`

**Interfaces:**
- Consumes: `runSend` (Task 5), `initSettingsDb`/`getSetting`/`setSetting` (Task 2), `encryptSecret`/`decryptSecret` (Task 3), `ProviderConfig` (Task 4).
- Produces (on `window.nexra`):
  - `agent.cancel(chatId: string): Promise<void>`
  - `settings.get(): Promise<{ provider: string; model: string; baseUrl: string; hasKey: boolean }>`
  - `settings.set(partial: { provider?: string; model?: string; baseUrl?: string }): Promise<void>`
  - `settings.setKey(provider: string, plaintext: string): Promise<void>`

- [ ] **Step 1: Extend the preload bridge**

In `nexra/electron/preload.ts`, add `cancel` to the `agent` object and a new `settings` object:
```ts
  agent: {
    send: (req: any, onEvent: any) => { const ch = 'agent:event:' + req.chatId; const l = (_: any, e: any) => onEvent(e); ipcRenderer.on(ch, l); return ipcRenderer.invoke('agent:send', req).finally(() => ipcRenderer.removeListener(ch, l)) },
    install: (req: any, onEvent: any) => { const ch = 'agent:event:' + req.chatId; const l = (_: any, e: any) => onEvent(e); ipcRenderer.on(ch, l); return ipcRenderer.invoke('agent:install', req).finally(() => ipcRenderer.removeListener(ch, l)) },
    cancel: (chatId: string) => ipcRenderer.invoke('agent:cancel', chatId),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (partial: any) => ipcRenderer.invoke('settings:set', partial),
    setKey: (provider: string, plaintext: string) => ipcRenderer.invoke('settings:setKey', { provider, plaintext }),
  },
```

- [ ] **Step 2: Declare the new API surface**

In `nexra/src/global.d.ts`, add to `NexraApi`:
```ts
  agent: {
    send(req: AgentSendRequest, onEvent: (e: AgentEvent) => void): Promise<void>
    install(req: AgentInstallRequest, onEvent: (e: AgentEvent) => void): Promise<void>
    cancel(chatId: string): Promise<void>
  }
  settings: {
    get(): Promise<{ provider: string; model: string; baseUrl: string; hasKey: boolean }>
    set(partial: { provider?: string; model?: string; baseUrl?: string }): Promise<void>
    setKey(provider: string, plaintext: string): Promise<void>
  }
```

- [ ] **Step 3: Rewire main — imports, DB init, handlers**

In `nexra/electron/main.ts`:

Replace the mock import:
```ts
import { runSend } from './services/agent.live'
import { initSettingsDb, getSetting, setSetting } from './services/store.sqlite'
import { encryptSecret } from './services/secrets'
import type { ProviderConfig } from './services/providers'
```
(remove `import { runSend, runInstall } from './services/agent.mock'`).

Add a module-level abort registry and a config loader:
```ts
const inflight = new Map<string, AbortController>()

function loadConfig(): ProviderConfig {
  const provider = (getSetting('provider') ?? 'anthropic') as ProviderConfig['provider']
  const model = getSetting('model') ?? 'claude-opus-4-8'
  const baseUrl = getSetting('baseUrl') ?? 'http://localhost:11434'
  const blob = getSetting('secret.apikey.' + provider)
  let apiKey: string | undefined
  if (blob) { try { apiKey = require('./services/secrets').decryptSecret(blob) } catch { apiKey = undefined } }
  return { provider, model, baseUrl, apiKey }
}
```

In `app.whenReady().then(...)`, before `createWindow()`, init the DB and replace the agent handlers:
```ts
  initSettingsDb(path.join(app.getPath('userData'), 'nexra.db'))

  ipcMain.handle('agent:send', async (ev, req) => {
    const ctrl = new AbortController()
    inflight.set(req.chatId, ctrl)
    try {
      await runSend(req, loadConfig(), e => ev.sender.send('agent:event:' + req.chatId, e), ctrl.signal)
    } finally {
      inflight.delete(req.chatId)
    }
  })
  ipcMain.handle('agent:cancel', (_ev, chatId: string) => { inflight.get(chatId)?.abort() })
  ipcMain.handle('agent:install', (ev, req) =>
    ev.sender.send('agent:event:' + req.chatId, { type: 'error', message: 'Tool install arrives with agent execution in M3b' }))

  ipcMain.handle('settings:get', () => ({
    provider: getSetting('provider') ?? 'anthropic',
    model: getSetting('model') ?? 'claude-opus-4-8',
    baseUrl: getSetting('baseUrl') ?? 'http://localhost:11434',
    hasKey: !!getSetting('secret.apikey.' + (getSetting('provider') ?? 'anthropic')),
  }))
  ipcMain.handle('settings:set', (_ev, partial: Record<string, string>) => {
    for (const k of ['provider', 'model', 'baseUrl'] as const) if (partial[k] != null) setSetting(k, partial[k])
  })
  ipcMain.handle('settings:setKey', (_ev, { provider, plaintext }: { provider: string; plaintext: string }) =>
    setSetting('secret.apikey.' + provider, encryptSecret(plaintext)))
```
(remove the old `ipcMain.handle('agent:send', ...)` and `agent:install` mock lines.)

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean. (`runInstall`/`agent.mock` no longer referenced — the file is deleted in Task 8.)

- [ ] **Step 5: Commit**
```bash
git add electron/preload.ts electron/main.ts src/global.d.ts
git commit -m "feat(m3a): main/preload IPC — live agent, cancel, settings + secret, DB init"
```

---

## Task 8: Renderer IPC client (history, streaming, delta/error, cancel) + delete mock

**Files:**
- Modify: `nexra/src/ipc.ts`
- Delete: `nexra/electron/services/agent.mock.ts`, `nexra/test/agent.mock.test.ts`
- Test: `nexra/test/ipc.test.ts`

**Interfaces:**
- Consumes: `window.nexra.agent.{send,cancel}`, reducer actions from Task 6.
- Produces:
  - `sendMessage(dispatch, chat, eng, text)` — now dispatches `setStreaming on`, builds `history` from `chat.messages`, and applies `text_delta`/`error`/`done`.
  - `cancelStream(chatId: string): void` — calls `window.nexra.agent.cancel`.

- [ ] **Step 1: Write the failing round-trip test**

Create `nexra/test/ipc.test.ts` (drives the real `applyEvent` path with a fake `window.nexra`):
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendMessage, cancelStream } from '../src/ipc'
import type { AgentEvent } from '../electron/services/agent.types'
import type { Chat, Engagement } from '../electron/services/store.types'

const chat = { id: 'c1', name: 'New chat', phaseId: '', color: '#000', tools: [{ name: 'prowler', available: true }],
  messages: [{ id: 'g', role: 'assistant', kind: 'text', content: 'greeting' }], findings: [] } as unknown as Chat
const eng = { type: 'aws', phases: [] } as unknown as Engagement

let sent: { req: any; onEvent: (e: AgentEvent) => void } | null
beforeEach(() => {
  sent = null
  ;(globalThis as any).window = { nexra: {
    agent: {
      send: (req: any, onEvent: any) => { sent = { req, onEvent }; return Promise.resolve() },
      cancel: vi.fn(() => Promise.resolve()),
    },
  } }
})

describe('sendMessage', () => {
  it('sends history built from prior messages and starts streaming', () => {
    const dispatched: any[] = []
    sendMessage((a: any) => dispatched.push(a), chat, eng, 'hello there')
    expect(dispatched).toContainEqual({ t: 'appendUserMessage', chatId: 'c1', text: 'hello there' })
    expect(dispatched).toContainEqual({ t: 'setStreaming', chatId: 'c1', on: true })
    expect(sent!.req.history).toEqual([{ role: 'assistant', content: 'greeting' }])
    expect(sent!.req.text).toBe('hello there')
  })
  it('maps text_delta/done into reducer actions and clears streaming on done', () => {
    const dispatched: any[] = []
    sendMessage((a: any) => dispatched.push(a), chat, eng, 'hi')
    sent!.onEvent({ type: 'text_delta', delta: 'yo' })
    sent!.onEvent({ type: 'done' })
    expect(dispatched).toContainEqual({ t: 'appendTextDelta', chatId: 'c1', delta: 'yo' })
    expect(dispatched).toContainEqual({ t: 'setStreaming', chatId: 'c1', on: false })
  })
  it('maps error into appendError and clears streaming', () => {
    const dispatched: any[] = []
    sendMessage((a: any) => dispatched.push(a), chat, eng, 'hi')
    sent!.onEvent({ type: 'error', message: '401' })
    expect(dispatched).toContainEqual({ t: 'appendError', chatId: 'c1', message: '401' })
    expect(dispatched).toContainEqual({ t: 'setStreaming', chatId: 'c1', on: false })
  })
})

describe('cancelStream', () => {
  it('calls agent.cancel', () => {
    cancelStream('c1')
    expect((window as any).nexra.agent.cancel).toHaveBeenCalledWith('c1')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- ipc.test`
Expected: FAIL — `cancelStream` not exported / history + streaming not dispatched.

- [ ] **Step 3: Update `applyEvent`, `sendMessage`, add `cancelStream`**

In `nexra/src/ipc.ts`, add `text_delta`/`error` cases and clear streaming on `done`/`error`. Replace the `applyEvent` switch body's relevant parts:
```ts
      case 'text':
        dispatch({ t: 'appendText', chatId, text: e.text })
        break
      case 'text_delta':
        dispatch({ t: 'appendTextDelta', chatId, delta: e.delta })
        break
```
Add before the closing of the switch (alongside `finding`/`done`):
```ts
      case 'error':
        dispatch({ t: 'appendError', chatId, message: e.message })
        dispatch({ t: 'setStreaming', chatId, on: false })
        break
      case 'done':
        dispatch({ t: 'setStreaming', chatId, on: false })
        break
```
(remove the old empty `case 'done': break`.)

Replace `sendMessage` to build history + set streaming:
```ts
export function sendMessage(dispatch: Dispatch<Action>, chat: Chat, eng: Engagement, text: string): void {
  const trimmed = text.trim()
  if (!trimmed) return
  const history = chat.messages
    .filter(m => m.kind === 'text' && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content as string }))
  dispatch({ t: 'appendUserMessage', chatId: chat.id, text: trimmed })
  dispatch({ t: 'setStreaming', chatId: chat.id, on: true })
  const primaryTool = chat.tools.find(t => t.available)?.name ?? 'shell'
  const runningIds = new Map<string, string>()
  window.nexra.agent.send(
    { chatId: chat.id, engagementType: eng.type, phaseLabel: phaseLabel(eng, chat.phaseId), primaryTool, text: trimmed, history },
    applyEvent(dispatch, chat.id, runningIds),
  )
}

export function cancelStream(chatId: string): void {
  window.nexra.agent.cancel(chatId)
}
```
(`installTool` stays as-is — its no-op error now flows through the new `error` case.)

- [ ] **Step 4: Delete the mock and its test**

```bash
git rm electron/services/agent.mock.ts test/agent.mock.test.ts
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test -- ipc.test && npx tsc --noEmit`
Expected: PASS; tsc clean (nothing imports `agent.mock` now).

- [ ] **Step 6: Full suite**

Run: `npm test`
Expected: all green (mock test gone; new tests present).

- [ ] **Step 7: Commit**
```bash
git add src/ipc.ts
git commit -m "feat(m3a): renderer IPC — history, streaming, delta/error, cancel; drop mock"
```

---

## Task 9: Composer busy-lock + Stop button

**Files:**
- Modify: `nexra/src/components/Composer.tsx`, `nexra/src/components/ChatPane.tsx`
- Test: `nexra/test/Composer.test.tsx`

**Interfaces:**
- Consumes: `state.ui.streamingChats`, `cancelStream` (Task 8).
- Produces: `Composer` accepts `busy?: boolean` and `onStop?: () => void`.

- [ ] **Step 1: Write the failing test**

Create `nexra/test/Composer.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Composer } from '../src/components/Composer'

describe('Composer busy-lock', () => {
  it('shows Send (not Stop) when idle and calls onSend', () => {
    const onSend = vi.fn()
    render(<Composer draft="hi" placeholder="p" dispatch={() => {}} onSend={onSend} busy={false} onStop={() => {}} />)
    const send = screen.getByTitle('Send')
    send.click()
    expect(onSend).toHaveBeenCalled()
    expect(screen.queryByTitle('Stop')).toBeNull()
  })
  it('shows Stop and calls onStop when busy', () => {
    const onStop = vi.fn()
    render(<Composer draft="hi" placeholder="p" dispatch={() => {}} onSend={() => {}} busy={true} onStop={onStop} />)
    const stop = screen.getByTitle('Stop')
    stop.click()
    expect(onStop).toHaveBeenCalled()
    expect(screen.queryByTitle('Send')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- Composer`
Expected: FAIL — no Stop button; props unknown.

- [ ] **Step 3: Add busy/onStop to Composer**

In `nexra/src/components/Composer.tsx`, extend the props and swap the send button when busy. Update the signature:
```tsx
export function Composer({
  draft,
  placeholder,
  dispatch,
  onSend = () => {},
  busy = false,
  onStop = () => {},
}: {
  draft: string
  placeholder: string
  dispatch: Dispatch<Action>
  onSend?: () => void
  busy?: boolean
  onStop?: () => void
}) {
```
Guard the Enter key while busy:
```tsx
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!busy) onSend()
    }
  }
```
Replace the send `Hoverable` (the `title="Send"` button) with a conditional. When `busy`, render a Stop button (same 30×30 circle, same `theme.accent` background — preserve the exact styling; swap the glyph to `■` and wire `onStop`):
```tsx
              {busy ? (
                <Hoverable
                  as="button"
                  type="button"
                  onClick={onStop}
                  title="Stop"
                  hoverStyle={{ background: theme.accentHover }}
                  baseStyle={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: '50%', border: 'none', background: theme.accent, color: '#fff', fontSize: 12, cursor: 'pointer', transition: 'background .12s' }}
                >
                  ■
                </Hoverable>
              ) : (
                <Hoverable
                  as="button"
                  type="button"
                  onClick={onSend}
                  title="Send"
                  hoverStyle={{ background: theme.accentHover }}
                  baseStyle={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: '50%', border: 'none', background: theme.accent, color: '#fff', fontSize: 15, cursor: 'pointer', transition: 'background .12s' }}
                >
                  ↑
                </Hoverable>
              )}
```

- [ ] **Step 4: Wire ChatPane**

In `nexra/src/components/ChatPane.tsx`: import `cancelStream`:
```ts
import { sendMessage, installTool, cancelStream } from '../ipc'
```
Compute busy and pass props to `Composer` (replace the existing `<Composer .../>` line):
```tsx
      <Composer
        draft={state.ui.draft}
        placeholder={composerPlaceholder}
        dispatch={dispatch}
        onSend={onSend}
        busy={!!state.ui.streamingChats[chat.id]}
        onStop={() => cancelStream(chat.id)}
      />
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- Composer`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**
```bash
git add src/components/Composer.tsx src/components/ChatPane.tsx test/Composer.test.tsx
git commit -m "feat(m3a): composer busy-lock + Stop wired to per-chat cancel"
```

---

## Task 10: Settings screen — real load/save

**Files:**
- Modify: `nexra/src/components/Settings.tsx`
- Test: `nexra/test/Settings.test.tsx`

**Interfaces:**
- Consumes: `window.nexra.settings.{get,set,setKey}` (Task 7).
- Produces: Settings persists provider/model/baseURL on change and stores the key via `setKey`; the key field never shows a stored value (only a "key is set" state).

- [ ] **Step 1: Write the failing test**

Create `nexra/test/Settings.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { Settings } from '../src/components/Settings'

const api = { get: vi.fn(), set: vi.fn(() => Promise.resolve()), setKey: vi.fn(() => Promise.resolve()) }
beforeEach(() => {
  api.get.mockReset().mockResolvedValue({ provider: 'ollama', model: 'llama3.3', baseUrl: 'http://localhost:11434', hasKey: false })
  api.set.mockClear(); api.setKey.mockClear()
  ;(globalThis as any).window = { nexra: { settings: api } }
})

describe('Settings persistence', () => {
  it('loads persisted provider on open', async () => {
    render(<Settings state={{} as any} dispatch={() => {}} />)
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    await waitFor(() => expect((screen.getByDisplayValue('Ollama') as HTMLSelectElement)).toBeTruthy())
  })
  it('persists the API key via setKey, never rendering it back', async () => {
    api.get.mockResolvedValue({ provider: 'anthropic', model: 'claude-opus-4-8', baseUrl: 'http://localhost:11434', hasKey: false })
    render(<Settings state={{} as any} dispatch={() => {}} />)
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    const key = await screen.findByPlaceholderText('sk-...')
    fireEvent.change(key, { target: { value: 'sk-secret' } })
    fireEvent.blur(key)
    await waitFor(() => expect(api.setKey).toHaveBeenCalledWith('anthropic', 'sk-secret'))
    expect(api.get).not.toHaveReturnedWith(expect.objectContaining({ apiKey: expect.anything() }))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- Settings`
Expected: FAIL — component never calls `window.nexra.settings`.

- [ ] **Step 3: Wire Settings to the settings API**

In `nexra/src/components/Settings.tsx`, replace the inert local-only state with load-on-mount + persist-on-change. Keep all existing markup/styling; change the state wiring:
- Add `import { useEffect } from 'react'` to the existing React import.
- Load persisted settings on mount and seed local state:
```tsx
  useEffect(() => {
    window.nexra.settings.get().then(s => {
      setProvider(s.provider as ProviderId)
      setModel(s.model)
      setBaseUrl(s.baseUrl)
      setKeySet(s.hasKey)
    })
  }, [])
```
- Add `const [keySet, setKeySet] = useState(false)` alongside the other state.
- Persist provider/model/baseURL when they change. Update `selectProvider`, the model `onChange`, and the baseURL `onChange` to also call `window.nexra.settings.set(...)`:
```tsx
  const selectProvider = (id: ProviderId) => {
    setProvider(id); setModel(PROVIDERS[id].defaultModel)
    window.nexra.settings.set({ provider: id, model: PROVIDERS[id].defaultModel })
  }
```
Model select `onChange`:
```tsx
            onChange={e => { setModel(e.target.value); window.nexra.settings.set({ model: e.target.value }) }}
```
Base URL input `onChange` (keep default) add a blur persist:
```tsx
                onChange={e => setBaseUrl(e.target.value)}
                onBlur={e => window.nexra.settings.set({ baseUrl: e.target.value })}
```
- Persist the API key on blur and never read it back. Replace the API-key `<input>` block so its value is a transient local field, and on blur it calls `setKey` and marks `keySet`:
```tsx
              <div style={labelStyle}>{cfg.label} API key</div>
              <input
                type="password"
                value={apiKeys[provider]}
                onChange={e => setApiKey(e.target.value)}
                onBlur={e => { if (e.target.value) { window.nexra.settings.setKey(provider, e.target.value); setKeySet(true) } }}
                placeholder={keySet ? '•••••••• (set — type to replace)' : 'sk-...'}
                autoComplete="off"
                style={fieldStyle}
              />
```
- Change the footer note copy from "Live model calls arrive in a later build." to "Saved locally. API key stored in your OS keychain." (single-line, keep the existing style object).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- Settings`
Expected: PASS (2 tests).

- [ ] **Step 5: Full suite + typecheck + build**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all green; tsc + build clean.

- [ ] **Step 6: Commit**
```bash
git add src/components/Settings.tsx test/Settings.test.tsx
git commit -m "feat(m3a): Settings loads/persists config + stores key in keychain"
```

---

## Manual verification (run before opening M3a for review)

Do these on macOS (and Windows if available) — the automated suite can't cover the Electron runtime or live network:

1. `npm run dev`. Confirm the app launches and the DB loads (no `NODE_MODULE_VERSION` error in the console; if present, `npx electron-rebuild --only better-sqlite3` and relaunch).
2. Settings → Anthropic, pick a model, paste a real key, close. Reopen Settings: provider/model persist and the key field shows the "set" placeholder (never the key). Quit + relaunch: settings still persist.
3. Send a message in a chat → tokens stream in live; the chat remembers a follow-up question's context.
4. Press Stop mid-response → stream halts, partial text stays, composer returns to Send.
5. Settings → Ollama (with `ollama serve` running + a pulled model) → messages stream from the local model with no key.
6. Break it: wrong key / Ollama down → a clear `⚠ …` error message in the chat, composer usable again, no crash.

## Self-Review (completed by plan author)

- **Spec coverage:** provider layer (T4), live streaming agent + system prompt + history + abort (T5), `text_delta`/`error` contract (T5/T6/T8), `agent:cancel` (T7/T8), SQLite settings (T2), safeStorage secret never returned to renderer (T3/T7/T10), busy-lock + Stop (T9), real Settings (T10), install no-op (T7), better-sqlite3 ABI risk spike (T1), all testing bullets mapped, acceptance items covered by the manual checklist. ✅
- **Placeholder scan:** no TBD/TODO; every code step shows complete code. ✅
- **Type consistency:** `ProviderConfig`, `runSend(req, cfg, emit, signal)`, `AgentSendRequest.history`, `streamingChats`, `appendTextDelta`/`appendError`/`setStreaming`, `settings.{get,set,setKey}`, `cancelStream` used identically across tasks. ✅
