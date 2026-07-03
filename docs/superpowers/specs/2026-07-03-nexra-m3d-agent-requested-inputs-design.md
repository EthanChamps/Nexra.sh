# M3d — Agent-Requested Inputs

**Date:** 2026-07-03
**Status:** Design approved; ready for implementation plan
**Depends on:** M3a (live agent), M3b (typed-skill layer + vault), M3c (findings/evidence)

## Problem

When the operator asks the agent to conduct an audit (e.g. "conduct a CIS review
against an AWS organisation, what do you need from me?"), the agent has no way to
turn "I need AWS credentials" into an actionable UI. Its entire toolset is
`run_prowler`, `run_scoutsuite`, `run_pmapper`, `probe`, `log_finding`,
`attach_evidence` — none create or request a credential. So the model does the
only thing it can: it types a prose wishlist ("provide an IAM Role with
SecurityAudit, the Org ID, and regions") and waits. The operator then has to go
find the Secrets panel and hand-author matching slots.

The codebase was clearly headed toward fixing this — the vault already supports
`createdBy: 'agent'`, a `RequestCard` component exists, and the reducer has a
`fulfillSecretRequest` handler — but the path is unfinished and, in its current
state, non-functional:

- `applyEvent` (`src/ipc.ts:28-65`) dispatches only `text`, `text_delta`,
  `tool_call`, `finding`, `error`, `done`. It **silently drops** the
  `secret_request`, `scope_request`, and `skill` events the backend emits.
- Gate 3 of `runSkill` (`electron/services/agent.tools.ts:84`) emits
  `secret_request` with `fields: []` and no id, but `RequestCard`
  (`src/components/RequestCard.tsx:19,23`) requires both populated `fields` and a
  `secretId` to render. Even if the event weren't dropped, the card couldn't draw.

## Goal

The agent can proactively surface a **fill-these-inputs card** inline in the chat.
The operator fills the values (marking which are non-secret), everything
auto-saves, and the agent auto-resumes once all *required* inputs are present.

## Decisions (locked)

1. **UX: inline card in chat** (not a button that opens the side panel). Closest
   to the existing `RequestCard` scaffolding; keeps the operator in the thread.
2. **Free-form items, operator-curated sensitivity.** The agent invents the item
   names/keys per request; each item carries the agent's *hint* about whether it
   is sensitive, and the operator can flip any item between secret and non-secret.
   The agent's wishlist is really a mix of *inputs* — only some are truly secret
   (AWS keys); others are plain config (Org ID, region).
3. **Auto-resume when every *required* item is filled.** Optional items may be
   left blank. Partial required fills just save and wait. Honors the ungated /
   autonomous execution model while still refusing to fire a scan at a client's
   live cloud before it has what it needs.
4. **Reconcile the hard-gate to be field-based** (see §6). Necessary consequence
   of the free-form choice.

## Design

### 1. Agent-facing tool: `request_inputs`

A new typed skill the agent invokes via the existing `SKILL_CALL[...]` grammar
(`agent.live.ts`), so no new parsing dialect. It carries a list of items; each
item has:

- `key` — the env-var name the value is injected as (e.g. `AWS_ACCESS_KEY_ID`).
- `label` — human description shown in the card.
- `sensitive` — the agent's hint (true → masked/encrypted by default).
- `required` — must-have (gates auto-resume) vs optional.

Encoding of the list within a single `SKILL_CALL` (to preserve the `STEP_CAP`
budget in `runSend`) is finalized in the implementation plan; the contract is a
single call carrying N items, not N calls.

The system prompt gains a short instruction: when the agent needs credentials or
config from the operator, call `request_inputs` rather than describing them in
prose.

### 2. Inline card (renderer)

Rendered directly under the agent's message (generalizing/replacing the
`requestKind: 'secret'` branch of `RequestCard`). Per requested item, one row:

- Label + input.
- **Sensitivity toggle.** Sensitive rows use a masked (`password`) input with a
  *"not a secret"* action to downgrade and unmask. Non-sensitive rows show
  plaintext with a *"mark secret"* action to upgrade.
- Required items are visually marked.
- Status line: e.g. *"2 of 3 required filled."*
- **No save button** — each field auto-saves on change (debounced).

Styling matches the vendored prototype (`design-reference/Nexra.dc.html`) —
exact hex/px, no decorative icons.

### 3. Storage — one path, a `sensitive` flag

Add `sensitive: boolean` to the `Secret` type (`store.types.ts`).

- **Sensitive items** encrypt through the existing `fillSecret` /
  `safeStorage` path and remain masked everywhere in the renderer.
- **Non-sensitive items** store as a plaintext value and render in the clear in
  the Secrets panel.
- **Both** flow into the child-process env via the existing `injectEnv` loop
  (`secrets.vault.ts:83-95`), so a scan receives every value regardless of
  sensitivity. Injection stays main-process-only; the agent never sees the env.

The agent-created slot is stamped `createdBy: 'agent'` (already modeled).

### 4. Event wiring (the bug fix)

- Replace the crippled `secret_request` with a unified **`input_request`** event
  carrying the full item list + a `requestId`.
- Wire `applyEvent` (`src/ipc.ts`) to dispatch `input_request` (and stop dropping
  `skill` and `scope_request` — those are separate latent bugs surfaced here).
- Generalize the reducer's `fulfillSecretRequest` into the fill handler for this
  card.
- **One card component, two entry points:** the **proactive** `request_inputs`
  tool (planning time — the case in the transcript) and the **reactive** Gate 3
  (agent tries to run a scan without creds) both emit `input_request` and render
  the same card.

### 5. Auto-resume

Filling auto-saves silently. When **every `required` item has a value**, the app
fires a resume that re-enters the agent send loop (`runSend`) with a synthetic
"inputs provided" continuation, and the agent proceeds. Optional items left blank
do not block. Partial required fills save and wait for the rest.

### 6. Field-based hard-gate reconciliation

Because the agent now free-forms names, Gate 3 changes from *"is there a secret
literally named `aws`?"* (`hasFilledSecret(companyId, 'aws')`) to *"are the env
vars this skill needs present among filled secrets?"* (e.g. `AWS_ACCESS_KEY_ID`
and `AWS_SECRET_ACCESS_KEY`).

This preserves the real guarantee — **a scan cannot spawn without its
credentials** — even when the operator names the secret whatever they like.
Without it, free-form naming would let creds be filled yet still read as
"missing" by the gate.

`SkillDef` gains a way to declare the env vars it requires (replacing / alongside
`requiredSecret`); `runSkill` Gate 3 checks their presence in the injected env
map. This is a behavioral change to an existing safety gate and must be covered
by tests that assert: (a) present vars → spawn allowed, (b) missing vars → blocked
with an `input_request`, never spawns.

## Out of scope (YAGNI)

- A "Create Secrets" button that opens the side panel (rejected in favor of the
  inline card).
- Predefined credential *types* with canonical fields (rejected in favor of
  free-form items).
- Non-AWS credential packs (Azure / M365) — the request/card/storage machinery is
  generic, but only AWS skills exist to gate against today.
- Editing an already-filled item from the inline card (use the Secrets panel).

## Testing

- **Vault:** `sensitive` round-trips; non-sensitive values store plaintext and are
  returned by list surfaces while sensitive values never are; both appear in
  `injectEnv` output.
- **Gate (§6):** present required env vars → spawn; missing → blocked +
  `input_request`, no spawn.
- **Event flow:** `input_request` reaches the reducer via `applyEvent`; filling
  the last required item triggers exactly one resume; optional-blank does not.
- **Card:** sensitivity toggle switches masking and storage path; required-count
  status reflects fills; auto-save fires per field.

## Affected files (indicative)

- `electron/services/agent.tools.ts` — `request_inputs` skill; Gate 3 field-based
  check; `input_request` event.
- `electron/services/agent.live.ts` — dispatch `request_inputs`; resume entry.
- `electron/services/agent.types.ts` — `input_request` event type.
- `electron/services/secrets.vault.ts`, `store.types.ts`, `store.sqlite.ts` —
  `sensitive` flag + non-sensitive storage path.
- `electron/main.ts`, `electron/preload.ts` — IPC/bridge for fill + resume.
- `src/ipc.ts` — dispatch `input_request` / `skill` / `scope_request`.
- `src/state/reducer.ts` — generalized fill handler + resume trigger.
- `src/components/RequestCard.tsx` (+ card the inline request renders through).
