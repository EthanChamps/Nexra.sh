# Nexra.sh — M3b (Agent-driven AWS Auditing + Credential Vault) Design

**Date:** 2026-07-02
**Status:** Approved (design), implementation in progress
**Scope:** M3b — the first real execution vertical of M3 in
`docs/superpowers/specs/2026-07-02-nexra-internal-usable-plan.md`.
**Prereqs:** M1 (UI shell) + M2 (real terminals) merged; M3a (live
conversational agent) building.

## 1. Goal

Make the agent **autonomously run the AWS config-review vertical** (IAM,
Storage/S3, Network/VPC, Logging phases) using **Prowler, ScoutSuite, PMapper**
— ungated, with safety designed in — and give pen testers a **per-project
credential vault** the agent can *use* but never *see*.

The credential vault is the feature that motivated this milestone: a pen tester
stores client credentials (AWS keys, and later web-app/API creds) encrypted per
project; the agent logs into AWS to run its tools, but the plaintext never
crosses into the model's context, the chat transcript, or the LLM provider.

**Explicitly NOT in M3b** (later milestones): mutating pen-test verticals
(internal/external — those may reintroduce per-action approval); OpenAI/Google
providers; engagement/message/finding persistence + external memory (M4);
web-app-form and HTTP-header credential channels (deferred — see §11).

## 2. Decisions locked during brainstorming (2026-07-02)

- **First vertical = AWS config-review, read-only.** Prowler/ScoutSuite/PMapper
  enumerate; they do not mutate the target. Because the vertical is read-only,
  the agent runs **ungated** — no per-action approval prompts. Safety comes from
  scope enforcement + the typed-skill boundary, not click-through. *(Forward
  note: gating policy is a function of the vertical's read/write nature — later
  mutating verticals may reintroduce per-action approval.)*
- **Execution channel = separate captured-exec + mirror.** The agent invokes
  **typed skills** whose child processes run in the main process; the agent
  receives structured stdout/exit-code to reason over, and output is **mirrored
  read-only into the shared dock**. The agent gets **no freeform shell** — this
  is what makes both the scope guarantee and the "can't see secrets" guarantee
  real.
- **Scope enforcement below the LLM.** A structured, trusted scope record per
  engagement; every typed-skill invocation is validated against it in main;
  out-of-scope = hard deny the agent cannot override. No skill executes until a
  scope record exists (the gate).
- **AWS credentials injected as env vars** into the typed-skill child process
  (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`).
  Nothing on disk; env dies with the process; the agent never receives the
  child's env, only the tool's stdout.
- **Secrets persisted now.** Extend M3a's "sqlite for settings only" to
  **settings + secrets + scope**. Engagement/message/finding persistence stays
  M4.

## 3. Threat model (what the guarantee is, honestly)

**Protects against:** the plaintext credential reaching the model's context, the
chat transcript, exported findings, or the LLM provider; and cross-client bleed
(Client A's creds appearing in Client B's shell/tools).

**How:** the model works with **references, not values**. Values are decrypted
only in the main process, only at the moment a child process is spawned, and set
in that child's environment. The model sees the command and its stdout — never
the key.

**Why the guarantee is strong here (not merely best-effort):** the agent has
**no freeform shell** — it can only invoke a fixed allowlist of typed skills,
none of which echo their environment. So the agent cannot run
`echo $AWS_SECRET_ACCESS_KEY`. This is the same typed-skill boundary that
enforces scope.

**Does NOT protect against:** a maliciously modified main-process binary, or a
future decision to grant the agent a freeform shell (which would reintroduce the
exfiltration path — see the mutating-vertical forward note). The
operator-facing dock shell *is* freeform, but that is the human's own shell,
not the agent's.

## 4. Architecture

New / changed files under `nexra/electron/services/`:

- **`secrets.vault.ts`** (new) — per-project credential vault. CRUD over a
  plaintext **metadata index** (id, companyId, name, `fields:[{envVar}]`,
  `status`, `aliasOf`, `createdBy`) plus **encrypted value blobs**. Exposes
  `injectEnv(companyId): Record<string,string>` — decrypts only **filled**
  secrets (resolving `aliasOf`), returns an env map. Called only in main, only
  at child spawn. Wraps existing `secrets.ts` (`encryptSecret`/`decryptSecret`).
- **`scope.ts`** (new) — engagement scope record get/set + `validate(target,
  scope)` (account/region against `mode:'all'|'allowlist'`) + the pre-exec gate
  (`requireScope(engagementId)`).
- **`agent.tools.ts`** (new) — the typed-skill registry: `run_prowler`,
  `run_scoutsuite`, `run_pmapper`, each with typed args `{ account, region,
  phase }`. `runSkill(invocation, ctx)` validates args → checks scope →
  resolves creds via `injectEnv` → spawns the tool as a child process →
  captures stdout/exit-code as `tool_call` events → mirrors output read-only to
  the dock. A skill lacking a required filled secret returns
  `blocked(awaiting-secret)` and emits a `secret_request`.
- **`shell.pty.ts`** (modified) — re-key the session registry from `ShellId` to
  a composite `companyId:ShellId` so each project gets its own PTYs; inject
  `injectEnv(companyId)` into the spawn env; **strip inherited `AWS_*` from
  `process.env`** before spawning so no credential bleeds across projects
  (resolves the standing `shell.pty.ts:35` warning).
- **`agent.live.ts`** (extended) — add the tool-calling loop: the model may call
  the typed skills + `request_secret(name, fields)` + `request_scope()`; a
  blocked skill pauses the turn until the operator fulfils the request.
- **`store.sqlite.ts`** (extended) — add `secrets` and `scope` tables + a
  migration; keep the `settings` table from M3a.

**No renderer component imports a service** — everything stays behind
`window.nexra.*`.

## 5. Data model

```ts
// store.types.ts — NEW
export interface Secret {
  id: string
  companyId: string                      // per-project (Company = client)
  name: string                           // reference the agent uses, e.g. "aws-prod"
  fields: { envVar: string }[]           // WHICH env vars; values live encrypted, never here
  status: 'pending' | 'filled'
  aliasOf?: string                       // "tie to existing" → id of another Secret
  createdBy: 'operator' | 'agent'
}

export interface EngagementScope {
  mode: 'all' | 'allowlist'
  accounts: string[]                     // AWS account ids (empty when mode='all')
  regions: string[]                      // AWS regions   (empty when mode='all')
}
```

- `Engagement` gains `enforcement?: EngagementScope` (the typed, *enforced*
  scope). The existing `scope: ScopeRow[]` remains for the human-readable
  Scope panel.
- `Message` gains `kind: 'request'` with `requestKind: 'secret' | 'scope'` and a
  payload, rendered as an interactive card reusing the ported tool-card chrome.

The **encrypted value** for each `Secret.field` is stored separately from the
metadata index and never appears in any renderer-facing type.

## 6. AgentEvent contract change (`agent.types.ts`)

Extend the union:

```ts
| { type: 'tool_call'; id: string; skill: string
    state: 'running' | 'output' | 'success' | 'denied' | 'blocked'
    chunk?: string; message?: string }         // wired real (was unused)
| { type: 'secret_request'; name: string; fields: { envVar: string }[] }
| { type: 'scope_request' }
```

- `tool_call` → renders/updates a tool card; `denied` (scope) and `blocked`
  (awaiting-secret) are honest terminal/paused states.
- `secret_request` / `scope_request` → render request cards; fulfilment
  (fill secret / set scope) resumes the blocked run.

## 7. IPC / preload (`window.nexra`)

- `secrets`: `list(companyId)`, `create(slot)`, `fill(id, values)`,
  `tie(id, aliasOf)`, `delete(id)`. **Values travel renderer→main only; never
  returned** (mirror the API-key "never read back" rule from M3a).
- `scope`: `get(engagementId)`, `set(engagementId, config)`.
- `shell.create` gains `companyId`.

## 8. UI (renderer)

- **Secrets area** — a new **tab in the right context panel** (alongside
  Scope / Findings / Tools; already project/engagement-scoped), plus a
  **New/Edit Secret modal** reusing ported modal patterns. Lists names + status
  (`pending`/`filled`) — never values. New functional UI built in the existing
  visual language; icon-light per CLAUDE.md (no design-reference glyph to copy).
- **In-chat request cards** — secret and scope requests as interactive cards in
  the message list (tool-card chrome + a fill/tie or scope form).
- **Dock mirror** — agent tool output streams read-only into the shared dock.

## 9. Persistence (scoped extension of M3a)

sqlite grows from "settings only" to **settings + secrets + scope**. Dedicated
`secrets` and `scope` tables (M3a already has a migration runner) — chosen over
namespaced KV because we need *list-by-project* and a `pending/filled` status.
Engagement/message/finding persistence stays **M4**.

## 10. Two internal phases (incremental value)

- **M3b-1 — vault substrate:** sqlite tables, `secrets.vault.ts`, `scope.ts`,
  per-project shell re-key + injection + `process.env` strip, IPC, Secrets UI,
  reducer. **Lands and is fully testable without the agent loop or any AWS tool
  installed** — the operator immediately gets working, isolated,
  transcript-safe creds. The de-risking slice.
- **M3b-2 — agent consumption:** `agent.tools.ts` typed-skill layer + AWS pack,
  scope enforcement wired into execution, the tool-calling loop in
  `agent.live.ts`, request cards, dock mirror.

The **injection mechanism** — "child env has the creds, agent-facing events do
not" — is provable in M3b-1 with a fake echo-the-env skill, so the core
guarantee is verified before the real AWS pack (which needs the tools installed
+ an AWS account) is wired.

## 11. Deferred credential channels

Web-app-form login (needs browser automation) and HTTP/API-header injection are
deferred. The vault schema (`fields:[{envVar}]`) covers env-var channels; a
later `fields` variant can carry header/form targets without a data migration.

## 12. Testing (Vitest — pure-vs-native split, mirroring M2/M3a)

- **`secrets.vault.ts`** — encrypt→decrypt roundtrip (safeStorage mocked as in
  M3a); metadata list never contains a value; `injectEnv` returns only
  **filled** secrets and resolves `aliasOf`; unavailable-safeStorage errors, no
  plaintext fallback.
- **`scope.ts`** — in-scope allowed, out-of-scope denied, `mode:'all'` allows
  anything, gate blocks when no record set.
- **`agent.tools.ts`** — with a fake echo-env skill: a valid invocation spawns a
  child whose **env contains the creds** while the agent-facing `tool_call`
  events **do not**; a denied (out-of-scope) invocation never spawns; a skill
  missing its secret yields `blocked` + `secret_request`.
- **`shell.pty.ts`** — two companies get isolated env; switching does not bleed;
  `process.env` `AWS_*` stripped before spawn; killing a session ends the OS
  process (mirror M2's PID test).
- **request flow** — `request_secret` → pending slot → `fill` → resume;
  tie-to-existing alias.
- **reducer / IPC roundtrip** — new events → `applyEvent` → reducer state;
  secrets/scope IPC never returns values.

`tsc --noEmit` + `npm run build` clean; all prior tests still green.

## 13. Acceptance

- **M3b-1:** an operator creates a `filled` AWS secret on a project; opening a
  terminal in that project makes `aws sts get-caller-identity` succeed, and the
  secret's value appears in **no** renderer state, message, or transcript.
  Switching to another project's terminal does **not** carry the first
  project's creds. A unit test proves the injected child env holds the creds
  while agent-facing events do not.
- **M3b-2:** in an AWS config-review chat, the agent autonomously runs
  Prowler/ScoutSuite/PMapper against an in-scope account, streams real output
  mirrored into the dock; an out-of-scope target is denied below the model; a
  missing credential pops an in-chat request the operator fills to unblock the
  run. *(Requires the tools installed + an AWS account — the plan's "Done
  when".)*

## 14. Risks

- **Tool-pack environmental deps** — Prowler/ScoutSuite/PMapper must be
  installed to execute; a true acceptance run needs an AWS account/benchmark.
  M3b-1 sidesteps this; M3b-2 carries it.
- **`safeStorage` unavailable** (Linux/dev) — hard error, never plaintext
  fallback (M3a's stance).
- **`better-sqlite3` × Electron ABI** — already de-risked in M3a; new tables
  ride the existing migration runner.

## 15. Process & references

Built with the locked process: this spec → `superpowers:writing-plans` →
`superpowers:subagent-driven-development` → merge.

- Milestone plan: `docs/superpowers/specs/2026-07-02-nexra-internal-usable-plan.md`
- M3a spec: `docs/superpowers/specs/2026-07-02-nexra-m3a-live-agent-design.md`
- Competitive requirements: `docs/superpowers/specs/2026-07-02-competitive-requirements.md`
- Handover: `docs/superpowers/HANDOVER.md`
- App: `nexra/`
