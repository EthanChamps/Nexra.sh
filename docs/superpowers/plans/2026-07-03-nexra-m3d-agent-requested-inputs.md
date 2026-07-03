# M3d — Agent-Requested Inputs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the live agent surface an inline "fill these inputs" card in chat; the operator fills the values (marking which are non-secret), everything auto-saves, and the agent auto-resumes once every required input is present.

**Architecture:** A new `request_inputs` typed skill lets the model emit a structured list of needed inputs, which becomes an `input_request` agent event. `applyEvent` (currently drops it) dispatches it into a `kind:'request'` chat message the existing `RequestCard` renders. Each field auto-saves through a new `inputs:fulfill` IPC into the credential vault, which gains a `sensitive` flag so non-secret values store in the clear while secrets stay encrypted; both still inject into the tool env. The existing skill hard-gate is re-expressed in terms of required env-var names so free-form secret names still can't let a scan run without credentials.

**Tech Stack:** Electron (main + preload + renderer), React, TypeScript, Vercel AI SDK v6, better-sqlite3, Vitest.

## Global Constraints

- Cross-platform (macOS + Windows); no OS-specific code paths in this feature.
- No renderer component may import a service directly — always go through `window.nexra.*` (`contextBridge`).
- Credentials are handled in plaintext ONLY in the main process; the renderer sends plaintext once and never reads a secret value back. Metadata list surfaces never carry secret values.
- Styling must match the vendored prototype `nexra/design-reference/Nexra.dc.html` — exact hex/px; icons only for action/status, never decoration.
- Tests run with `npm test` (`vitest run`) from `nexra/`. All existing tests must stay green (37+ baseline).
- Every code step is TDD: failing test first, minimal implementation, green, commit.

---

## File-by-file responsibility map

- `electron/services/store.types.ts` — add `sensitive` to `Secret`; add `InputRequestItem`; extend `Message` + `MessageKind` with the `request` shape.
- `electron/services/store.sqlite.ts` — `sensitive` column migration + row mapping.
- `electron/services/secrets.vault.ts` — `sensitive`-aware inject; `filledEnvVars`; `upsertFilledInput`.
- `electron/services/agent.types.ts` — replace `secret_request` with `input_request`.
- `electron/services/agent.tools.ts` — `SkillDef.requiredEnvVars`; field-based Gate 3 emitting `input_request`; AWS skills updated.
- `electron/services/agent.live.ts` — parse/handle `request_inputs`; halt loop awaiting input; new deps wiring.
- `electron/main.ts` — `inputs:fulfill` IPC handler.
- `electron/preload.ts` — `window.nexra.inputs.fulfill`.
- `src/state/reducer.ts` — `appendInputRequest` / `appendScopeRequest` actions.
- `src/ipc.ts` — dispatch `input_request` / `scope_request` / `skill`; `resumeAfterInputs`.
- `src/components/RequestCard.tsx` — the `inputs` branch (per-item input, sensitivity toggle, auto-save, resume).
- `src/components/MessageList.tsx` + `src/components/ChatPane.tsx` — thread `companyId` + `onResume` to the card.

---

## Task 1: `sensitive` on the Secret model + sqlite migration

**Files:**
- Modify: `nexra/electron/services/store.types.ts:68-77`
- Modify: `nexra/electron/services/store.sqlite.ts:17-26` (schema), `:84` (row iface), `:86-108` (mapping)
- Test: `nexra/test/store.sqlite.native.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Secret.sensitive?: boolean`; sqlite round-trips it (`true`→1, `false`→0, absent→NULL→`undefined`).

- [ ] **Step 1: Add `sensitive` to the `Secret` type**

In `store.types.ts`, extend the `Secret` interface (after `createdBy`):

```ts
export interface Secret {
  id: string
  companyId: string
  name: string
  fields: SecretField[]
  status: 'pending' | 'filled'
  aliasOf?: string
  createdBy: 'operator' | 'agent'
  sensitive?: boolean               // absent = sensitive (legacy default); false = plain config value
}
```

- [ ] **Step 2: Write the failing sqlite round-trip test**

Append to `nexra/test/store.sqlite.native.test.ts` (follow the existing `initSettingsDb(join(dir,'nexra.db'))` setup pattern used in that file):

```ts
import { insertSecretMeta, getSecretMeta } from '../electron/services/store.sqlite'

it('round-trips the sensitive flag (true/false/undefined)', () => {
  insertSecretMeta({ id: 's-sens', companyId: 'c1', name: 'AWS_SECRET_ACCESS_KEY', fields: [{ envVar: 'AWS_SECRET_ACCESS_KEY' }], status: 'filled', createdBy: 'agent', sensitive: true })
  insertSecretMeta({ id: 's-plain', companyId: 'c1', name: 'ORG_ID', fields: [{ envVar: 'ORG_ID' }], status: 'filled', createdBy: 'agent', sensitive: false })
  insertSecretMeta({ id: 's-legacy', companyId: 'c1', name: 'aws-prod', fields: [{ envVar: 'AWS_ACCESS_KEY_ID' }], status: 'pending', createdBy: 'operator' })
  expect(getSecretMeta('s-sens')!.sensitive).toBe(true)
  expect(getSecretMeta('s-plain')!.sensitive).toBe(false)
  expect(getSecretMeta('s-legacy')!.sensitive).toBeUndefined()
})
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `cd nexra && npx vitest run test/store.sqlite.native.test.ts -t "sensitive flag"`
Expected: FAIL — the `sensitive` column does not exist yet (SQLite error on insert, or the value comes back `undefined` for the `true`/`false` cases).

- [ ] **Step 4: Add the column migration + row mapping**

In `store.sqlite.ts`, immediately after the `CREATE TABLE IF NOT EXISTS secrets (...)` block (ends line 26), add an additive migration (safe on existing DBs):

```ts
  // Additive migration (M3d): older DBs created the secrets table without it.
  // ALTER throws if the column already exists — swallow that one case only.
  try { db.exec('ALTER TABLE secrets ADD COLUMN sensitive INTEGER') } catch { /* column already present */ }
```

Update `SecretMetaRow` (line 84) to include the column:

```ts
interface SecretMetaRow { id: string; company_id: string; name: string; fields: string; status: string; alias_of: string | null; created_by: string; sensitive: number | null }
```

Update `rowToSecret` (lines 86-94) to map it:

```ts
function rowToSecret(r: SecretMetaRow): Secret {
  return {
    id: r.id, companyId: r.company_id, name: r.name,
    fields: JSON.parse(r.fields) as SecretField[],
    status: r.status as Secret['status'],
    aliasOf: r.alias_of ?? undefined,
    createdBy: r.created_by as Secret['createdBy'],
    sensitive: r.sensitive == null ? undefined : r.sensitive === 1,
  }
}
```

Update `insertSecretMeta` (lines 96-108) to write it:

```ts
export function insertSecretMeta(s: Secret): void {
  requireDb().prepare(
    `INSERT INTO secrets (id, company_id, name, fields, status, alias_of, created_by, sensitive)
     VALUES (@id, @company_id, @name, @fields, @status, @alias_of, @created_by, @sensitive)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, fields=excluded.fields, status=excluded.status,
       alias_of=excluded.alias_of, created_by=excluded.created_by, sensitive=excluded.sensitive`,
  ).run({
    id: s.id, company_id: s.companyId, name: s.name,
    fields: JSON.stringify(s.fields), status: s.status,
    alias_of: s.aliasOf ?? null, created_by: s.createdBy,
    sensitive: s.sensitive == null ? null : (s.sensitive ? 1 : 0),
  })
}
```

- [ ] **Step 5: Run tests to confirm green**

Run: `cd nexra && npx vitest run test/store.sqlite.native.test.ts`
Expected: PASS (new test + all existing sqlite tests).

- [ ] **Step 6: Commit**

```bash
git add nexra/electron/services/store.types.ts nexra/electron/services/store.sqlite.ts nexra/test/store.sqlite.native.test.ts
git commit -m "feat(m3d): sensitive flag on Secret + sqlite migration"
```

---

## Task 2: vault — sensitivity-aware inject, `filledEnvVars`, `upsertFilledInput`

**Files:**
- Modify: `nexra/electron/services/secrets.vault.ts:83-95` (inject) + append two functions
- Test: `nexra/test/secrets.vault.test.ts`

**Interfaces:**
- Consumes: `Secret.sensitive` (Task 1); `insertSecretMeta`, `setSecretValue`, `getSecretValueBlob`, `listSecretMetaByCompany`, `getSecretMeta`, `encryptSecret`, `decryptSecret` (existing).
- Produces:
  - `filledEnvVars(companyId: string): string[]` — every env-var name across a company's FILLED secrets (no decryption).
  - `upsertFilledInput(companyId: string, key: string, value: string, sensitive: boolean): Secret` — create-or-update a single-field secret named `key`, store its value (encrypted iff `sensitive`), flip to `filled`.
  - `injectEnv` now returns plaintext for `sensitive === false` fields.

- [ ] **Step 1: Write failing tests**

Append to `nexra/test/secrets.vault.test.ts` (the mocked-`safeStorage` setup at the top of that file makes `encryptSecret`→`enc:`+value and `decryptSecret` strip it):

```ts
import { filledEnvVars, upsertFilledInput } from '../electron/services/secrets.vault'

describe('secrets.vault — agent inputs (M3d)', () => {
  it('upsertFilledInput stores a sensitive value encrypted and injects it decrypted', () => {
    upsertFilledInput('c1', 'AWS_ACCESS_KEY_ID', 'AKIA-XYZ', true)
    expect(injectEnv('c1')).toEqual({ AWS_ACCESS_KEY_ID: 'AKIA-XYZ' })
    expect(JSON.stringify(listSecrets('c1'))).not.toContain('AKIA-XYZ')   // never in metadata
  })

  it('upsertFilledInput stores a non-secret value in the clear and injects it as-is', () => {
    upsertFilledInput('c1', 'ORG_ID', 'o-123456', false)
    const s = listSecrets('c1').find(x => x.name === 'ORG_ID')!
    expect(s.sensitive).toBe(false)
    expect(injectEnv('c1').ORG_ID).toBe('o-123456')
  })

  it('upserting the same key twice updates in place (no duplicate slot)', () => {
    upsertFilledInput('c1', 'REGION', 'us-east-1', false)
    upsertFilledInput('c1', 'REGION', 'eu-west-1', false)
    expect(listSecrets('c1').filter(x => x.name === 'REGION')).toHaveLength(1)
    expect(injectEnv('c1').REGION).toBe('eu-west-1')
  })

  it('filledEnvVars lists env vars of filled secrets only', () => {
    const pending = createSecret({ companyId: 'c2', name: 'aws', fields: [{ envVar: 'AWS_ACCESS_KEY_ID' }], createdBy: 'operator' })
    expect(filledEnvVars('c2')).toEqual([])                 // pending → excluded
    fillSecret(pending.id, { AWS_ACCESS_KEY_ID: 'AKIA' })
    upsertFilledInput('c2', 'AWS_SECRET_ACCESS_KEY', 'shh', true)
    expect(new Set(filledEnvVars('c2'))).toEqual(new Set(['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']))
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd nexra && npx vitest run test/secrets.vault.test.ts -t "M3d"`
Expected: FAIL — `filledEnvVars` / `upsertFilledInput` are not exported.

- [ ] **Step 3: Implement the two functions + sensitivity-aware inject**

In `secrets.vault.ts`, change `injectEnv` (line 91) so non-sensitive values are not run through `decryptSecret`:

```ts
      const blob = getSecretValueBlob(source.id, f.envVar)
      if (blob != null) env[f.envVar] = source.sensitive === false ? blob : decryptSecret(blob)
```

Append at end of file:

```ts
// Every env-var name across a company's FILLED secrets, WITHOUT decrypting any
// value. Used by the skill hard-gate (M3d) to decide, by field presence rather
// than by a fixed secret name, whether a scan may run.
export function filledEnvVars(companyId: string): string[] {
  const out: string[] = []
  for (const s of listSecretMetaByCompany(companyId)) {
    if (s.status !== 'filled') continue
    const source = s.aliasOf ? getSecretMeta(s.aliasOf) : s
    if (!source) continue
    for (const f of source.fields) out.push(f.envVar)
  }
  return out
}

// Create-or-update a single-field secret named `key` and fill it in one step
// (the agent-requested-input path). Sensitive values are encrypted; non-secret
// config values are stored in the clear. Idempotent per (companyId, key).
export function upsertFilledInput(companyId: string, key: string, value: string, sensitive: boolean): Secret {
  const existing = listSecretMetaByCompany(companyId).find(s => s.name === key)
  const id = existing?.id ?? randomUUID()
  const secret: Secret = {
    id, companyId, name: key, fields: [{ envVar: key }],
    status: 'filled', createdBy: existing?.createdBy ?? 'agent', sensitive,
  }
  insertSecretMeta(secret)
  setSecretValue(id, key, sensitive ? encryptSecret(value) : value)
  return secret
}
```

- [ ] **Step 4: Run to confirm green**

Run: `cd nexra && npx vitest run test/secrets.vault.test.ts`
Expected: PASS (new + existing vault tests).

- [ ] **Step 5: Commit**

```bash
git add nexra/electron/services/secrets.vault.ts nexra/test/secrets.vault.test.ts
git commit -m "feat(m3d): vault upsertFilledInput + filledEnvVars + sensitive-aware inject"
```

---

## Task 3: `input_request` event + field-based skill gate

**Files:**
- Modify: `nexra/electron/services/store.types.ts` (add `InputRequestItem`)
- Modify: `nexra/electron/services/agent.types.ts:7,14` (replace `secret_request`)
- Modify: `nexra/electron/services/agent.tools.ts:14-20,29-38,82-87,121-137`
- Test: `nexra/test/agent.tools.test.ts`

**Interfaces:**
- Consumes: `filledEnvVars` (Task 2).
- Produces:
  - `InputRequestItem { key: string; label: string; sensitive: boolean; required: boolean }` (in `store.types.ts`).
  - `AgentEvent` variant `{ type: 'input_request'; requestId: string; items: InputRequestItem[] }` (replaces `secret_request`).
  - `SkillDef.requiredEnvVars?: string[]` (replaces `requiredSecret`).
  - `RunDeps.filledEnvVars(companyId: string): string[]` (replaces `hasFilledSecret`).

- [ ] **Step 1: Add the shared `InputRequestItem` type**

In `store.types.ts`, after the `SecretField`/`Secret` block, add:

```ts
// One input the agent asks the operator to provide (M3d). `key` is the env var
// the value injects as; `sensitive` masks + encrypts it; `required` gates the
// agent's auto-resume. Defined here (not agent.types) to avoid a type cycle —
// both the event layer and the renderer message use it.
export interface InputRequestItem { key: string; label: string; sensitive: boolean; required: boolean }
```

- [ ] **Step 2: Replace `secret_request` with `input_request` in the event union**

In `agent.types.ts`, update the import (line 1) and the union (line 14):

```ts
import type { Severity, ToolState, SecretField, Evidence, InputRequestItem } from './store.types'
```

Replace line 14:

```ts
  | { type: 'input_request'; requestId: string; items: InputRequestItem[] }
```

(Leave `SecretField` in the import — it is still used by other event fields. Update the `blocked` comment on line 4-5 to say "paired with an input_request".)

- [ ] **Step 3: Write the failing gate tests**

In `nexra/test/agent.tools.test.ts`, replace the existing "blocks (and requests a secret)…" test body and add a pass-through case. The test helper `baseDeps` currently supplies `hasFilledSecret`; change it to `filledEnvVars`:

```ts
function baseDeps(over: Partial<RunDeps> = {}): RunDeps {
  return {
    getScope: () => ({ mode: 'all', accounts: [], regions: [] }),
    injectEnv: () => ({ AWS_SECRET_ACCESS_KEY: SECRET_VALUE }),
    filledEnvVars: () => ['AWS_SECRET_ACCESS_KEY'],
    baseEnv: { PATH: process.env.PATH },
    ...over,
  }
}

it('blocks and emits an input_request when a required env var is missing — never spawns', async () => {
  const spy = vi.fn(nodeSpawn)
  const { events, emit } = collect()
  const needsCred: SkillDef = { ...probeSkill, requiredEnvVars: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] }
  const result = await runSkill(inv, needsCred, emit, baseDeps({ filledEnvVars: () => [], spawn: spy as any }))

  expect(result.state).toBe('blocked')
  expect(spy).not.toHaveBeenCalled()
  const req = events.find(e => e.type === 'input_request') as any
  expect(req.items.map((i: any) => i.key)).toEqual(['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'])
  expect(req.items.every((i: any) => i.sensitive && i.required)).toBe(true)
})

it('runs when every required env var is filled', async () => {
  const { events, emit } = collect()
  const needsCred: SkillDef = { ...probeSkill, requiredEnvVars: ['AWS_SECRET_ACCESS_KEY'] }
  const result = await runSkill(inv, needsCred, emit, baseDeps())   // filledEnvVars has it
  expect(result.state).toBe('success')
  expect(events.some(e => e.type === 'input_request')).toBe(false)
})
```

- [ ] **Step 4: Run to confirm failure**

Run: `cd nexra && npx vitest run test/agent.tools.test.ts`
Expected: FAIL — `RunDeps` still has `hasFilledSecret`; `SkillDef` has no `requiredEnvVars`; no `input_request` emitted. (Type + assertion failures.)

- [ ] **Step 5: Rewire `SkillDef`, `RunDeps`, Gate 3, and the AWS skills**

In `agent.tools.ts`:

Replace `requiredSecret` in `SkillDef` (lines 16-17):

```ts
export interface SkillDef {
  name: string
  // Env vars that must be FILLED (present in the injected env) before this runs.
  requiredEnvVars?: string[]
  build(inv: SkillInvocation): { command: string; args: string[] }
}
```

Replace `hasFilledSecret` in `RunDeps` (line 32):

```ts
  filledEnvVars(companyId: string): string[]
```

Replace Gate 3 (lines 82-87):

```ts
  // Gate 3 — every required credential env var must be FILLED; else request the
  // missing ones and never spawn. Field-based (not fixed-name) so the operator
  // may name the secret anything (M3d).
  if (def.requiredEnvVars && def.requiredEnvVars.length) {
    const have = new Set(deps.filledEnvVars(inv.companyId))
    const missing = def.requiredEnvVars.filter(k => !have.has(k))
    if (missing.length) {
      emit({ type: 'input_request', requestId: id, items: missing.map(k => ({ key: k, label: k, sensitive: true, required: true })) })
      emit({ type: 'skill', id, skill: def.name, state: 'blocked', message: 'awaiting credential: ' + missing.join(', ') })
      return Promise.resolve({ state: 'blocked', reason: 'awaiting-secret' })
    }
  }
```

Update the three AWS skills (lines 121-137) — swap `requiredSecret: 'aws'` for the env vars each reads:

```ts
export const AWS_SKILLS: Record<string, SkillDef> = {
  run_prowler: {
    name: 'run_prowler',
    requiredEnvVars: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
    build: inv => ({ command: 'prowler', args: ['aws', ...(inv.region ? ['-f', inv.region] : [])] }),
  },
  run_scoutsuite: {
    name: 'run_scoutsuite',
    requiredEnvVars: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
    build: () => ({ command: 'scout', args: ['aws'] }),
  },
  run_pmapper: {
    name: 'run_pmapper',
    requiredEnvVars: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
    build: () => ({ command: 'pmapper', args: ['graph', 'create'] }),
  },
}
```

- [ ] **Step 6: Run to confirm green**

Run: `cd nexra && npx vitest run test/agent.tools.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add nexra/electron/services/store.types.ts nexra/electron/services/agent.types.ts nexra/electron/services/agent.tools.ts nexra/test/agent.tools.test.ts
git commit -m "feat(m3d): input_request event + field-based skill hard-gate"
```

---

## Task 4: `request_inputs` proactive skill in the agent loop

**Files:**
- Modify: `nexra/electron/services/agent.live.ts:8,32-47,78-129`
- Test: `nexra/test/agent.live.m3b.test.ts` (or a new `test/agent.live.inputs.test.ts` following its harness)

**Interfaces:**
- Consumes: `filledEnvVars` (Task 2), `input_request`/`InputRequestItem` (Task 3), `parseSkillCalls` (existing).
- Produces: when the model emits `SKILL_CALL[request_inputs|items=...]`, `runSend` emits one `input_request` event and ends the turn (no continuation step). Encoding: `items=KEY:LABEL:SENS:REQ;...` where `SENS` is `s` (sensitive, default) or `-`, `REQ` is `r` (required, default) or `-`.

- [ ] **Step 1: Write the failing test**

Create `nexra/test/agent.live.inputs.test.ts` using the exact mock harness from `test/agent.live.findings.test.ts` (mock `ai`, `providers`, `store.sqlite`; the `request_inputs` path never touches the vault/scope, so no companyId and no vault mock are needed):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const streamText = vi.fn()
vi.mock('ai', () => ({ streamText: (o: any) => streamText(o) }))
vi.mock('../electron/services/providers', () => ({ resolveModel: () => ({ tag: 'fake-model' }) }))
vi.mock('../electron/services/store.sqlite', () => ({ upsertFinding: vi.fn() }))

import { runSend } from '../electron/services/agent.live'
import type { AgentEvent, AgentSendRequest } from '../electron/services/agent.types'
import type { ProviderConfig } from '../electron/services/providers'

const req: AgentSendRequest = { chatId: 'chat-1', engagementType: 'aws', phaseLabel: 'Recon', primaryTool: 'prowler', text: 'audit', history: [] }
const cfg: ProviderConfig = { provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'sk-1' }
const fakeStream = (parts: string[]) => ({ textStream: (async function* () { for (const p of parts) yield p })(), usage: Promise.resolve({ totalTokens: 1 }) })
beforeEach(() => streamText.mockReset())

describe('runSend request_inputs (M3d)', () => {
  it('emits one input_request from a request_inputs skill call and ends the turn', async () => {
    streamText.mockReturnValueOnce(fakeStream([
      'I need credentials. SKILL_CALL[request_inputs|items=AWS_ACCESS_KEY_ID:AWS access key:s:r;ORG_ID:Organization ID:-:r;REGION:Target region:-:-]',
    ]))
    const events: AgentEvent[] = []
    await runSend(req, cfg, e => events.push(e), new AbortController().signal)

    const reqEv = events.find(e => e.type === 'input_request') as any
    expect(reqEv).toBeTruthy()
    expect(reqEv.items).toEqual([
      { key: 'AWS_ACCESS_KEY_ID', label: 'AWS access key', sensitive: true, required: true },
      { key: 'ORG_ID', label: 'Organization ID', sensitive: false, required: true },
      { key: 'REGION', label: 'Target region', sensitive: false, required: false },
    ])
    // request halts the loop: streamText called exactly once, exactly one done
    expect(streamText.mock.calls.length).toBe(1)
    expect(events.filter(e => e.type === 'done')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd nexra && npx vitest run test/agent.live.inputs.test.ts`
Expected: FAIL — `request_inputs` is unhandled, so no `input_request` event is emitted.

- [ ] **Step 3: Add the parser + document the skill in the prompt**

In `agent.live.ts`, update the deps import (line 8) to the new vault surface:

```ts
import { filledEnvVars, injectEnv } from './secrets.vault'
```

Add a parser near `parseSkillCalls` (after line 30):

```ts
import type { InputRequestItem } from './store.types'

// Decode the request_inputs `items=` arg: `KEY:LABEL:SENS:REQ;...`.
// SENS 's' (default) = sensitive; REQ 'r' (default) = required.
function parseInputItems(args: Record<string, string>): InputRequestItem[] {
  return (args.items ?? '').split(';').map(s => s.trim()).filter(Boolean).map(entry => {
    const [key, label, sens, req] = entry.split(':')
    return {
      key: (key ?? '').trim(),
      label: (label ?? key ?? '').trim(),
      sensitive: (sens ?? 's').trim() !== '-',
      required: (req ?? 'r').trim() !== '-',
    }
  }).filter(i => i.key)
}
```

Add a line to the `skills` block in `systemPrompt` (after the `attach_evidence` bullet, ~line 40):

```
- request_inputs|items=KEY:LABEL:SENS:REQ;...: Ask the operator to supply credentials/config. Each item is env-var KEY, a short LABEL, SENS ('s' secret/masked, default; '-' not secret), and REQ ('r' required, default; '-' optional). Use this instead of listing needed inputs in prose. The run pauses until every required item is filled.
```

- [ ] **Step 4: Handle `request_inputs` in the call loop and halt the turn**

In `runSend`, update the deps construction (line 121) to the new field:

```ts
          const deps: RunDeps = { getScope, injectEnv, filledEnvVars }
```

Inside the `for (const c of calls)` loop, add a branch BEFORE the `log_finding` check (top of the loop body, ~line 90) so a request short-circuits:

```ts
        if (c.name === 'request_inputs') {
          const items = parseInputItems(c.args)
          if (items.length) { emit({ type: 'input_request', requestId: randomUUID(), items }); requestedInputs = true }
          continue
        }
```

Declare the flag just before the loop (`const results: string[] = []` is at line 87 — add above it):

```ts
      let requestedInputs = false
```

After the `for (const c of calls)` loop closes (line 127) and BEFORE `messages.push({ role: 'user', content: results.join('\n') })`, add:

```ts
      if (requestedInputs) break   // await operator input; the card drives resume
```

- [ ] **Step 5: Run to confirm green + full suite**

Run: `cd nexra && npx vitest run test/agent.live.inputs.test.ts test/agent.live.m3b.test.ts`
Expected: PASS (new test green; the m3b suite still green after the deps rename).

- [ ] **Step 6: Commit**

```bash
git add nexra/electron/services/agent.live.ts nexra/test/agent.live.inputs.test.ts
git commit -m "feat(m3d): request_inputs proactive skill halts the turn awaiting input"
```

---

## Task 5: IPC + preload for `inputs.fulfill`

**Files:**
- Modify: `nexra/electron/main.ts:9,110-117` (import + handler)
- Modify: `nexra/electron/preload.ts:24-31` (bridge)
- Test: none — this is thin glue over `upsertFilledInput` (tested in Task 2). The repo does not unit-test `ipcMain.handle` wiring (there is no `main.test.ts`), matching the existing `secrets:fulfill-pending` handler which has no direct test.

**Interfaces:**
- Consumes: `upsertFilledInput` (Task 2).
- Produces: `window.nexra.inputs.fulfill(companyId, key, value, sensitive): Promise<{ success: boolean; error?: string }>`.

- [ ] **Step 1: Add the main-process handler**

In `main.ts`, extend the vault import (line 9):

```ts
import { createSecret, fillSecret, tieSecret, listSecrets, deleteSecret, upsertFilledInput } from './services/secrets.vault'
```

Add a handler next to `secrets:fulfill-pending` (after line 117):

```ts
  // ── fulfillment: operator fills one agent-requested input (M3d) ──
  ipcMain.handle('inputs:fulfill', (_ev, { companyId, key, value, sensitive }: { companyId: string; key: string; value: string; sensitive: boolean }) => {
    try {
      upsertFilledInput(companyId, key, value, sensitive)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
```

- [ ] **Step 2: Expose it on the bridge**

In `preload.ts`, after the `secrets: { ... }` object (line 31) add a sibling:

```ts
  // Agent-requested inputs — plaintext travels renderer→main once (mirrors secrets).
  inputs: {
    fulfill: (companyId: string, key: string, value: string, sensitive: boolean) =>
      ipcRenderer.invoke('inputs:fulfill', { companyId, key, value, sensitive }),
  },
```

- [ ] **Step 3: Verify it type-checks and builds**

Run: `cd nexra && npm run build`
Expected: `tsc` + `vite build` succeed with no type errors.

- [ ] **Step 4: Commit**

```bash
git add nexra/electron/main.ts nexra/electron/preload.ts
git commit -m "feat(m3d): inputs:fulfill IPC + window.nexra.inputs bridge"
```

---

## Task 6: renderer event wiring — request message + applyEvent dispatch

**Files:**
- Modify: `nexra/electron/services/store.types.ts:15,18-23` (`MessageKind` + `Message`)
- Modify: `nexra/src/state/reducer.ts:88-97` (actions) + a new case block
- Modify: `nexra/src/ipc.ts:28-65` (applyEvent cases)
- Test: `nexra/test/reducer.test.ts`, `nexra/test/ipc.test.ts`

**Interfaces:**
- Consumes: `InputRequestItem` (Task 3), `input_request` event (Task 3), `appendSkillEvent` (existing reducer action).
- Produces:
  - `MessageKind` includes `'request'`; `Message` carries `requestKind?: 'inputs' | 'scope'`, `requestId?: string`, `items?: InputRequestItem[]`, `engagementId?: string`.
  - reducer actions `appendInputRequest` and `appendScopeRequest`, each pushing one `kind:'request'` message.
  - `applyEvent` dispatches `input_request` → `appendInputRequest`, `scope_request` → `appendScopeRequest`, `skill` → `appendSkillEvent`.

- [ ] **Step 1: Extend the Message model**

In `store.types.ts`, update `MessageKind` (line 15) and `Message` (lines 18-23):

```ts
export type MessageKind = 'text' | 'tool' | 'request'
```

```ts
export interface Message {
  id: string; role: MessageRole; kind: MessageKind
  content?: string
  toolName?: string; command?: string; output?: string; duration?: string
  reason?: string; installCmd?: string; state?: ToolState
  // request cards (M3d): the agent asks the operator for inputs or scope
  requestKind?: 'inputs' | 'scope'; requestId?: string; items?: InputRequestItem[]; engagementId?: string
}
```

- [ ] **Step 2: Write the failing reducer test**

Append to `nexra/test/reducer.test.ts`. That file already defines `boot()` (`{ data: buildSnapshot(), ui: initialUI }`) and imports `activeEngagement` + `chatByGlobalId` from `../src/state/selectors` — reuse them (seed company `c1` has an engagement whose `chats[0]` exists, per the neighbouring `upsertToolCard` test):

```ts
describe('reducer — request cards (M3d)', () => {
  it('appendInputRequest pushes an inputs request message', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const chatId = activeEngagement(s)!.chats[0].id
    const items = [{ key: 'AWS_ACCESS_KEY_ID', label: 'AWS access key', sensitive: true, required: true }]
    s = reducer(s, { t: 'appendInputRequest', chatId, requestId: 'r1', items })
    const msgs = chatByGlobalId(s, chatId)!.messages
    const msg = msgs[msgs.length - 1]
    expect(msg.kind).toBe('request')
    expect(msg.requestKind).toBe('inputs')
    expect(msg.requestId).toBe('r1')
    expect(msg.items).toEqual(items)
  })

  it('appendScopeRequest pushes a scope request message', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const chatId = activeEngagement(s)!.chats[0].id
    s = reducer(s, { t: 'appendScopeRequest', chatId, engagementId: 'e1' })
    const msgs = chatByGlobalId(s, chatId)!.messages
    const msg = msgs[msgs.length - 1]
    expect(msg.kind).toBe('request')
    expect(msg.requestKind).toBe('scope')
    expect(msg.engagementId).toBe('e1')
  })
})
```

- [ ] **Step 3: Run to confirm failure**

Run: `cd nexra && npx vitest run test/reducer.test.ts -t "request cards"`
Expected: FAIL — actions `appendInputRequest` / `appendScopeRequest` are not in the union.

- [ ] **Step 4: Add the reducer actions**

In `reducer.ts`, add to the `Action` union (after line 94, near `appendSkillEvent`):

```ts
  | { t: 'appendInputRequest'; chatId: string; requestId: string; items: import('../../electron/services/store.types').InputRequestItem[] }
  | { t: 'appendScopeRequest'; chatId: string; engagementId: string }
```

Add the case handlers (after the `appendSkillEvent` case, ~line 257):

```ts
    case 'appendInputRequest': {
      const c = chatByGlobalId(s, a.chatId); if (!c) return state
      c.messages.push({ id: nextId('m'), role: 'assistant', kind: 'request', requestKind: 'inputs', requestId: a.requestId, items: a.items })
      return s
    }
    case 'appendScopeRequest': {
      const c = chatByGlobalId(s, a.chatId); if (!c) return state
      c.messages.push({ id: nextId('m'), role: 'assistant', kind: 'request', requestKind: 'scope', engagementId: a.engagementId })
      return s
    }
```

- [ ] **Step 5: Write the failing applyEvent (ipc) test**

Append to `nexra/test/ipc.test.ts` (uses the `sendMessage(dispatch, chat, eng, ...)` + `sent!.onEvent(...)` harness already in the file):

```ts
it('maps input_request / scope_request / skill events into reducer actions', () => {
  const dispatched: any[] = []
  sendMessage((a: any) => dispatched.push(a), chat, eng, 'hi')
  const items = [{ key: 'AWS_ACCESS_KEY_ID', label: 'AWS access key', sensitive: true, required: true }]
  sent!.onEvent({ type: 'input_request', requestId: 'r1', items })
  sent!.onEvent({ type: 'scope_request', engagementId: 'e1' })
  sent!.onEvent({ type: 'skill', id: 'sk1', skill: 'run_prowler', state: 'running' })
  expect(dispatched).toContainEqual({ t: 'appendInputRequest', chatId: 'c1', requestId: 'r1', items })
  expect(dispatched).toContainEqual({ t: 'appendScopeRequest', chatId: 'c1', engagementId: 'e1' })
  expect(dispatched).toContainEqual({ t: 'appendSkillEvent', chatId: 'c1', skillEvent: { type: 'skill', id: 'sk1', skill: 'run_prowler', state: 'running' } })
})
```

- [ ] **Step 6: Run to confirm failure**

Run: `cd nexra && npx vitest run test/ipc.test.ts -t "input_request"`
Expected: FAIL — `applyEvent` drops these three event types.

- [ ] **Step 7: Add the applyEvent cases**

In `src/ipc.ts`, inside `applyEvent`'s `switch (e.type)` (before the `default`-less end, after the `finding` case ~line 57), add:

```ts
      case 'input_request':
        dispatch({ t: 'appendInputRequest', chatId, requestId: e.requestId, items: e.items })
        break
      case 'scope_request':
        dispatch({ t: 'appendScopeRequest', chatId, engagementId: e.engagementId })
        break
      case 'skill':
        dispatch({ t: 'appendSkillEvent', chatId, skillEvent: e })
        break
```

- [ ] **Step 8: Run to confirm green**

Run: `cd nexra && npx vitest run test/reducer.test.ts test/ipc.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add nexra/electron/services/store.types.ts nexra/src/state/reducer.ts nexra/src/ipc.ts nexra/test/reducer.test.ts nexra/test/ipc.test.ts
git commit -m "feat(m3d): dispatch input_request/scope_request/skill into request messages"
```

---

## Task 7: inline input card + auto-save + auto-resume

**Files:**
- Modify: `nexra/src/components/RequestCard.tsx` (add the `inputs` branch)
- Modify: `nexra/src/components/MessageList.tsx:12,82-84` (thread `companyId` + `onResume`)
- Modify: `nexra/src/components/ChatPane.tsx:96` (wire the handler)
- Modify: `nexra/src/ipc.ts` (add `resumeAfterInputs`)
- Test: `nexra/test/MessageList.test.tsx` (or a new `RequestCard.test.tsx` mirroring its render harness)

**Interfaces:**
- Consumes: `window.nexra.inputs.fulfill` (Task 5), the `kind:'request'` message with `requestKind:'inputs'` (Task 6).
- Produces:
  - `RequestCard` renders an `inputs` card: per-item labelled input, masked iff sensitive, a per-item "not a secret" / "mark secret" toggle, required markers, an "N of M required filled" line; each field auto-saves on blur via `inputs.fulfill(companyId, key, value, sensitive)`; when every required item is saved it calls `onFulfill()` exactly once.
  - `resumeAfterInputs(dispatch, chat, eng, companyId?)` in `ipc.ts` — re-invokes `agent.send` with a synthetic "inputs provided, continue" prompt (no visible user bubble) and streams the reply through `applyEvent`.

- [ ] **Step 1: Write the failing card test**

Create `nexra/test/RequestCard.test.tsx` (follow `MessageList.test.tsx` for the `render` + `window.nexra` mock pattern):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RequestCard } from '../src/components/RequestCard'

const items = [
  { key: 'AWS_ACCESS_KEY_ID', label: 'AWS access key', sensitive: true, required: true },
  { key: 'REGION', label: 'Target region', sensitive: false, required: false },
]
const msg = { id: 'm1', role: 'assistant', kind: 'request', requestKind: 'inputs', requestId: 'r1', items }

let fulfill: ReturnType<typeof vi.fn>
beforeEach(() => {
  fulfill = vi.fn(() => Promise.resolve({ success: true }))
  ;(globalThis as any).window = { nexra: { inputs: { fulfill } } }
})

it('renders a masked input for sensitive items and a plain input for non-secret ones', () => {
  render(<RequestCard message={msg} companyId="co1" onFulfill={() => {}} />)
  expect((screen.getByLabelText('AWS access key') as HTMLInputElement).type).toBe('password')
  expect((screen.getByLabelText('Target region') as HTMLInputElement).type).toBe('text')
})

it('auto-saves a field on blur with its sensitivity', async () => {
  render(<RequestCard message={msg} companyId="co1" onFulfill={() => {}} />)
  const input = screen.getByLabelText('AWS access key')
  fireEvent.change(input, { target: { value: 'AKIA-1' } })
  fireEvent.blur(input)
  expect(fulfill).toHaveBeenCalledWith('co1', 'AWS_ACCESS_KEY_ID', 'AKIA-1', true)
})

it('calls onFulfill once all REQUIRED items are saved (optionals may stay blank)', async () => {
  const onFulfill = vi.fn()
  render(<RequestCard message={msg} companyId="co1" onFulfill={onFulfill} />)
  const input = screen.getByLabelText('AWS access key')       // the only required item
  fireEvent.change(input, { target: { value: 'AKIA-1' } })
  fireEvent.blur(input)
  await Promise.resolve(); await Promise.resolve()
  expect(onFulfill).toHaveBeenCalledTimes(1)
})

it('toggling "not a secret" unmasks the field and saves it as non-sensitive', async () => {
  render(<RequestCard message={msg} companyId="co1" onFulfill={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /not a secret/i }))   // on the AWS row
  const input = screen.getByLabelText('AWS access key') as HTMLInputElement
  expect(input.type).toBe('text')
  fireEvent.change(input, { target: { value: 'plain' } })
  fireEvent.blur(input)
  expect(fulfill).toHaveBeenCalledWith('co1', 'AWS_ACCESS_KEY_ID', 'plain', false)
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd nexra && npx vitest run test/RequestCard.test.tsx`
Expected: FAIL — `RequestCard` has no `inputs` branch and no `companyId` prop.

- [ ] **Step 3: Implement the `inputs` branch in RequestCard**

In `RequestCard.tsx`, extend the props and add the branch. Update the signature and props interface:

```tsx
export interface RequestCardProps {
  message: any
  companyId?: string
  onFulfill: () => void
}

export function RequestCard({ message, companyId, onFulfill }: RequestCardProps) {
```

Add this branch at the TOP of the component body (before the existing `requestKind === 'secret'` block). It keeps per-item value + sensitivity + saved state, saves on blur, and fires `onFulfill` once all required items are saved:

```tsx
  if (message.requestKind === 'inputs') {
    const items = (message.items ?? []) as { key: string; label: string; sensitive: boolean; required: boolean }[]
    const [values, setValues] = useState<Record<string, string>>({})
    const [sens, setSens] = useState<Record<string, boolean>>(() => Object.fromEntries(items.map(i => [i.key, i.sensitive])))
    const [saved, setSaved] = useState<Record<string, boolean>>({})
    const [resumed, setResumed] = useState(false)
    const [err, setErr] = useState('')

    const requiredKeys = items.filter(i => i.required).map(i => i.key)
    const filledCount = requiredKeys.filter(k => saved[k]).length

    const save = async (key: string) => {
      const value = values[key]
      if (!value) return
      try {
        const res = await window.nexra.inputs.fulfill(companyId!, key, value, sens[key])
        if (res && res.success === false) { setErr(res.error || 'Save failed'); return }
        const nextSaved = { ...saved, [key]: true }
        setSaved(nextSaved)
        if (!resumed && requiredKeys.every(k => nextSaved[k])) { setResumed(true); onFulfill() }
      } catch (e) { setErr((e as Error).message) }
    }

    return (
      <div style={{ background: theme.bg2, border: `1px solid ${theme.accent}`, borderRadius: '6px', padding: '12px', marginTop: '8px' }}>
        <div style={{ fontWeight: 500, marginBottom: '8px' }}>Inputs requested</div>
        {err && <div style={{ color: theme.error, fontSize: '12px', marginBottom: '8px' }}>{err}</div>}
        {items.map(it => (
          <div key={it.key} style={{ marginBottom: '10px' }}>
            <label htmlFor={`inp-${it.key}`} style={{ display: 'block', fontSize: '12px', color: theme.text3, marginBottom: '4px' }}>
              {it.label}{it.required ? ' *' : ''}
            </label>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input
                id={`inp-${it.key}`} aria-label={it.label}
                type={sens[it.key] ? 'password' : 'text'}
                value={values[it.key] || ''}
                onChange={e => setValues({ ...values, [it.key]: e.target.value })}
                onBlur={() => save(it.key)}
                placeholder="Enter value"
                style={{ flex: 1, padding: '6px', background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: '4px', color: theme.text1, fontSize: '12px' }}
              />
              <button
                type="button"
                onClick={() => setSens({ ...sens, [it.key]: !sens[it.key] })}
                style={{ padding: '6px 8px', background: theme.border, color: theme.text1, border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', whiteSpace: 'nowrap' }}
              >
                {sens[it.key] ? 'not a secret' : 'mark secret'}
              </button>
              {saved[it.key] && <span style={{ color: theme.accent, fontSize: '12px' }}>saved</span>}
            </div>
          </div>
        ))}
        <div style={{ fontSize: '12px', color: theme.text3, marginTop: '4px' }}>
          {filledCount} of {requiredKeys.length} required filled
        </div>
      </div>
    )
  }
```

(The `useState` import already exists at the top of the file.)

- [ ] **Step 4: Run to confirm the card tests pass**

Run: `cd nexra && npx vitest run test/RequestCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add `resumeAfterInputs` to ipc.ts**

In `src/ipc.ts`, add (after `sendMessage`, reusing the module-local `applyEvent` and `phaseLabel`):

```ts
// Resume the agent after the operator has filled a requested-input card. Unlike
// sendMessage this appends NO visible user bubble — it feeds the model a synthetic
// "continue" turn and streams the reply. The request card message is kind:'request',
// so it is naturally excluded from the text-only history below.
export function resumeAfterInputs(dispatch: Dispatch<Action>, chat: Chat, eng: Engagement, companyId?: string): void {
  const history = chat.messages
    .filter(m => m.kind === 'text' && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content as string }))
  dispatch({ t: 'setStreaming', chatId: chat.id, on: true })
  const primaryTool = chat.tools.find(t => t.available)?.name ?? 'shell'
  const runningIds = new Map<string, string>()
  window.nexra.agent.send(
    { chatId: chat.id, engagementType: eng.type, phaseLabel: phaseLabel(eng, chat.phaseId), primaryTool, text: 'The requested inputs have been provided. Continue.', history, companyId, engagementId: eng.id },
    applyEvent(dispatch, chat.id, runningIds),
  ).catch((err: unknown) => {
    dispatch({ t: 'appendError', chatId: chat.id, message: err instanceof Error ? err.message : 'Resume failed' })
    dispatch({ t: 'setStreaming', chatId: chat.id, on: false })
  })
}
```

- [ ] **Step 6: Thread `companyId` + `onResume` through MessageList and ChatPane**

In `MessageList.tsx`, extend the signature (line 12):

```tsx
export function MessageList({ chat, streaming, onInstall, companyId, onResume }: { chat: Chat; streaming: boolean; onInstall?: (msg: Message) => void; companyId?: string; onResume?: () => void }) {
```

Update the request render (lines 82-84):

```tsx
            {m.kind === 'request' && (
              <RequestCard message={m} companyId={companyId} onFulfill={onResume ?? (() => {})} />
            )}
```

In `ChatPane.tsx`, add a resume import and pass the props. Update the import (line 10):

```tsx
import { sendMessage, installTool, cancelStream, resumeAfterInputs } from '../ipc'
```

Update the `<MessageList ... />` render (line 96):

```tsx
      <MessageList chat={chat} streaming={!!state.ui.streamingChats[chat.id]} onInstall={onInstall} companyId={company?.id} onResume={() => resumeAfterInputs(dispatch, chat, eng, company?.id)} />
```

(`chat`, `eng`, `company`, and `dispatch` are already in scope in `ChatPane` — they are used by the existing `sendMessage(dispatch, chat, eng, state.ui.draft, company?.id)` call at line 25. If `eng` is under a different local name there, use that name.)

- [ ] **Step 7: Run the full suite + build**

Run: `cd nexra && npm test && npm run build`
Expected: all tests PASS (37 baseline + the M3d additions); `tsc` + `vite build` succeed.

- [ ] **Step 8: Commit**

```bash
git add nexra/src/components/RequestCard.tsx nexra/src/components/MessageList.tsx nexra/src/components/ChatPane.tsx nexra/src/ipc.ts nexra/test/RequestCard.test.tsx
git commit -m "feat(m3d): inline input card with per-field auto-save + auto-resume"
```

---

## Final verification

- [ ] **Run the whole suite:** `cd nexra && npm test` — all green.
- [ ] **Build:** `cd nexra && npm run build` — clean `tsc` + `vite build`.
- [ ] **Manual smoke (needs a display + a configured provider key):** `cd nexra && npm run dev`, open an AWS engagement chat, ask "conduct a CIS review against my AWS org — what do you need from me?"; confirm the agent emits a `request_inputs` card inline, that a sensitive field is masked with a working "not a secret" toggle, that filling the required fields shows "saved" and the agent resumes on its own, and that a subsequent `run_prowler` is no longer gate-blocked (it now spawns / reports the tool-missing error rather than re-requesting the credential).
- [ ] **Whole-branch review:** invoke `superpowers:requesting-code-review` before finishing the branch (matches the M1/M2/M3 process).

## Spec coverage check

- §1 agent tool → Task 4. §2 inline card + sensitivity toggle + auto-save → Task 7. §3 `sensitive` storage one-path → Tasks 1–2. §4 event wiring / stop dropping events → Tasks 3 (event) + 6 (dispatch). §5 auto-resume on required → Task 7 (`resumeAfterInputs` + required-count gate). §6 field-based hard-gate → Task 3. Out-of-scope items (side-panel button, predefined types, non-AWS packs, editing filled items from the card) are intentionally not implemented.
