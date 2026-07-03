# Project Scope — Design

**Date:** 2026-07-03
**Status:** Approved (brainstorming), pending implementation plan
**Milestone context:** Fits alongside M4 (persistence); introduces a new
project-level entity backed by sqlite.

## Summary

Add a **project-level scope** to the context area: a single, shared list of
authorized targets that every engagement in a project (client) uses. Scope is
both **informational** (shown in the context panel, read by the agent) and
**enforced** (feeds the below-the-LLM gate that decides which targets a tool
may run against). The consultant curates scope by hand, and the AI can propose
new items that become authorized only after the user confirms.

This **replaces** the two pre-existing, seed-only scope concepts (per-engagement
display `ScopeRow[]` and per-engagement enforced `EngagementScope`) with one
project-scoped source of truth. Their current data is throwaway test content, so
nothing of value is lost.

## Motivation

- A project = one client, and the client authorizes a set of targets. That
  authorization is naturally **project-wide**, not per-engagement — the same
  targets recur across the 5 engagement types (AWS/Azure/M365 config reviews,
  internal/external pen tests).
- Scope in a security engagement is an **authorization boundary**: "you may only
  test what you are authorized to test." Enforcing it below the LLM means the
  model cannot talk its way past it.
- During an engagement the agent legitimately discovers new in-scope assets
  (e.g. a subdomain found during recon). It should be able to bring those into
  scope, but only with explicit human sign-off.

## Data Model

A single project-level (company-keyed) scope, shared by every engagement:

```ts
ProjectScope {
  companyId: string
  items: ScopeItem[]     // flat list; everything listed is authorized (in-scope only)
  notes: string          // freeform rules-of-engagement / caveats, informational only
}

ScopeItem {
  id: string
  type: 'cidr' | 'ip' | 'hostname' | 'url'
      | 'cloud_account' | 'tenant_id' | 'region' | 'other'
  value: string
  source: 'user' | 'agent'   // provenance: hand-added vs AI-proposed-then-confirmed
  addedAt: number
}
```

Design decisions:

- **In-scope only.** Everything listed is authorized; there are no explicit
  out-of-scope exclusions. Carve-outs ("all of 10.0.0.0/8 except 10.0.0.5") live
  in `notes` and are **not** enforced.
- **`other`-typed items are informational** — the gate cannot match them, but
  they are allowed so nothing the user wants to record is rejected.
- **Notes are user-edited, AI-read.** The AI proposes *items*, never notes.
- Scope is shared across engagements exactly like the secrets vault (also
  company-keyed). The panel shows the same scope regardless of active
  engagement/chat.

## Enforcement — the below-the-LLM gate

The existing gate inside `runSkill` (`electron/services/agent.tools.ts`, main
process, un-bypassable by the model) is rewired from per-engagement
`EngagementScope` to project scope. For each tool call it derives the concrete
target(s) and authorizes the run only if **every** target matches an in-scope
item.

Target derivation and matching semantics (`matchesScope(companyId, {type, value})`):

- **Cloud tools** (`run_prowler`, `run_scoutsuite`, `run_pmapper`): target =
  cloud account id → must equal a `cloud_account` item's value.
- **Network/web tools** (future internal/external engagements):
  - an IP is in-scope if it equals an `ip` item **or** falls inside a `cidr` item;
  - a hostname is in-scope if it equals a `hostname` item **or** equals the host
    component of a `url` item;
  - a URL is in-scope if its host matches as above.
- `region` / `tenant_id` items constrain the corresponding fields when a tool
  supplies them; absence of such items does not add a constraint.
- `other` items never match (informational only).
- Empty scope denies everything (no implicit "allow all").

Today only AWS tools exist, so enforcement initially bites on `cloud_account`.
The model generalizes to pentest tools later with **no gate changes** — only new
target-derivation entries as those tools are added.

## AI Proposal + Confirm Flow

Reuses the existing **request-card → fulfill → resume** machinery (the same
pattern as agent-requested inputs/credentials). Two triggers, one card:

1. **Explicit proposal.** The agent emits
   `SKILL_CALL[propose_scope_item|type=…|value=…|reason=…]`, parsed like
   `request_inputs`. Used when the agent deliberately surfaces a newly discovered
   asset.
2. **Blocked-target proposal.** When a tool call's target fails the gate, instead
   of a dead-end refusal the gate emits the **same** proposal event, pre-filled
   with the inferred `{type, value}`.

Both emit a `scope_proposal` agent event that renders a proposal card in the
chat. The card lets the consultant **edit type/value, accept, or reject**:

- **Accept** → `projectScope.add(companyId, item)` with `source:'agent'` → the
  item is now authorized → the agent resumes. For the blocked-target case, the
  agent re-attempts the tool, which now passes the gate.
- **Reject** → the agent is told the proposal was declined and continues; no item
  is added.

## UI — the scope tab in `ContextPanel`

The existing read-only `scope` tab (`ContextPanel.tsx:91-103`) becomes an
editable, project-scoped panel. Because scope is shared, its content is identical
regardless of the active engagement/chat (like the secrets vault).

- **Items list** grouped by `type`; each row shows `value`, a provenance dot
  (user vs agent-added), and a remove (×) button.
- **"+ Add item"** inline row: type dropdown + value field → `projectScope.add`.
  Per-type shape hints (e.g. CIDR looks like `10.0.0.0/24`), but no hard
  validation that blocks entry — matches the app's lenient input style.
- **Notes** textarea at the bottom, debounced-saved via
  `projectScope.setNotes`.
- Styling ported exactly from `design-reference/Nexra.dc.html` per CLAUDE.md.
  No decorative icons; the provenance dot (status) and × (action) are meaningful
  and therefore kept.

## Persistence & IPC

- **sqlite** (`electron/services/store.sqlite.ts`): replace the per-engagement
  `scope` table with `project_scope` (`company_id, id, type, value, source,
  added_at`). Store notes as a `settings`-style keyed row `scope_notes:<companyId>`
  (no dedicated one-row table). Accessors: `listScopeItems(companyId)`,
  `addScopeItem`, `removeScopeItem`, `getScopeNotes` / `setScopeNotes`. Loaded
  into the graph on read.
- **Service:** rewrite `electron/services/scope.ts` to be company-keyed with the
  new model plus `matchesScope(companyId, {type, value})` used by the gate.
- **IPC namespace `projectScope`** (preload + `main.ts` handlers + `NexraApi` in
  `src/global.d.ts`): `list`, `add`, `remove`, `setNotes`, `get`. The gate calls
  the service directly in-process, not over IPC.
- **Events:** add `scope_proposal` to `electron/services/agent.types.ts`; wire
  through `src/ipc.ts` → reducer (`kind:'request'`, `requestKind:'scope_proposal'`)
  → `RequestCard` (adapt the existing scope form variant).
- **Renderer state:** project scope lives on the `Company` in the reducer
  (shared across its engagements), fetched on project load and updated on
  `add` / `remove` / proposal-confirm.

## Migration

- Drop the per-engagement `scope` table; create `project_scope` and the
  `scope_notes:<companyId>` settings rows. Existing scope data is seed/test-only,
  so no data migration is required — a schema migration test covers the
  drop/create per the M4 migration-test convention.
- Remove the `EngagementScope` type and per-engagement scope service surface;
  update `Engagement.enforcement` references accordingly.

## Testing

- **Unit — `matchesScope`:** CIDR containment; ip / hostname / url-host matching;
  `cloud_account` exact; `region`/`tenant_id` constraints; `other` never matches;
  empty scope denies. Replaces/extends `test/scope.test.ts`.
- **Persistence:** add / remove / list round-trip; notes survive a reopen;
  schema-migration test (drop old `scope` → create `project_scope`).
- **Enforcement (integration):** a tool call against an out-of-scope target is
  blocked and emits `scope_proposal`; after `projectScope.add`, the same call
  passes the gate.
- **Proposal flow (integration):** `propose_scope_item` skill → `scope_proposal`
  event → confirm → item persisted with `source:'agent'` → agent resume turn
  fires; reject → no item, agent continues.

## Process

Follow the project's TDD + implementer/reviewer subagent workflow (CLAUDE.md):
`writing-plans` → plan → `subagent-driven-development` (implementer + reviewer
per task, fix loops) → whole-branch review → `finishing-a-development-branch`.

## Out of Scope (YAGNI)

- Explicit out-of-scope exclusions / deny rules (carve-outs live in notes).
- AI-authored notes (AI proposes items only).
- Per-engagement scope overrides or subsetting (one flat project-wide list).
- Hard client-side validation of item values (lenient entry, gate matches best-effort).
