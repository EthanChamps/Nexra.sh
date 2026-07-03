# Nexra.sh — M3c (Finding Validation + Evidence) Design

**Date:** 2026-07-03
**Status:** Approved (design)
**Scope:** M3c — Phase 4 of
`docs/superpowers/specs/2026-07-02-nexra-internal-usable-plan.md`
("Finding validation + evidence", competitive Req 3).
**Prereqs:** M1 (UI shell) + M2 (real terminals) + M3a (live agent) + M3b
(agent-driven AWS exec + credential vault) merged.

## 1. Goal

Give the live agent an **evidence-gated path to log findings**, so every
surfaced finding carries a **checkable artifact** — captured tool output or an
agent-written code block naming the affected host and the issue — not just the
model's assertion (competitive Req 3).

A finding is **never dropped** for lacking evidence. It surfaces as
**unverified**, and the agent is **required to supply evidence within the turn**
to make it **verified**. Verification is computed **below the LLM** (main
process), never asserted by the model.

**Honest reframe (from the code):** the live agent emits **no findings today** —
only the retired mock did (`agent.live.ts` has no finding path;
`store.types.ts:25` `Finding` is still `{ title, sev, phase, time }`; the
`finding` event and `ContextPanel` render block are wired but nothing live
feeds them). So M3c **introduces agent-driven finding logging for the first
time**, evidence-gated from day one, and upgrades the execution loop to make
that real. There are no unverified legacy findings to retrofit.

**Explicitly NOT in M3c:** image/screenshot evidence capture (the `image`
evidence variant is *typed* now but wired later with the web/pentest verticals,
which produce screenshots — AWS CLI tools produce text); operator-authored
evidence (operator can *view*, not attach); report export (Phase 5);
engagement/message persistence beyond findings (M4). A native AI-SDK
tool-calling rewrite is out of scope — M3c reuses M3b's `SKILL_CALL` protocol
(see §3).

## 2. Data model (`store.types.ts`, `agent.types.ts`)

```ts
// store.types.ts
export type Evidence =
  | { kind: 'tool_output'; toolCallId: string; excerpt: string }  // ref to a captured run; excerpt snapshotted at resolve time
  | { kind: 'code_block'; host: string; detail: string }          // agent-written: affected host + the misconfiguration
  | { kind: 'image' }                                             // typed now; capture/storage/viewer deferred to web/pentest verticals

export interface Finding {
  id: string
  title: string
  sev: Severity
  phase: string
  time: string
  rationale: string        // NEW — why this severity (model's reasoning)
  evidence: Evidence[]     // NEW — ≥1 resolving artifact required to be verified
  verified: boolean        // NEW — computed in main; true once evidence resolves
}
```

- `rationale` is the model's justification for the severity; `evidence` is the
  checkable proof the misconfiguration exists. Both belong to a complete
  finding; **only `evidence` gates `verified`**.
- `verified = true` iff `evidence` contains at least one artifact that resolves:
  a `tool_output` whose `toolCallId` is found in the chat's captured-run
  registry (§3), or a `code_block` with non-empty `host` and `detail`. Computed
  in the main process at log/attach time; the model can neither set nor
  override it.
- The existing four fields keep their current meaning and wire.

## 3. Agent mechanism + loop upgrade (`agent.tools.ts`, `agent.live.ts`)

Two new typed skills join `run_prowler`/`run_scoutsuite`/`run_pmapper` in the
registry:

- **`log_finding(title, sev, phase, rationale, evidence?)`** — evidence is
  optional at log time. Creates the `Finding` and returns its `id` plus its
  computed `verified` status to the model.
- **`attach_evidence(findingId, evidence)`** — supplies an
  `evidence` artifact for an existing finding: a `tool_output=<toolCallId>`
  reference or an inline `code_block(host, detail)`. Re-computes `verified`.

**Enforcement in main (below the LLM):**

- A **captured-run registry** retains each `tool_call`'s stdout keyed by its
  `toolCallId`, per chat, for the life of the session. It is built from the
  output M3b already captures in `runSkill` — M3c retains it for resolution
  rather than only streaming it.
- Resolving a `tool_output` ref: look up `toolCallId` in the registry; if found,
  snapshot a bounded **excerpt** into the `Evidence` and mark the finding
  `verified`. If absent/unresolvable, the finding stays `verified:false` and the
  skill result tells the model the finding is **unverified and needs evidence**.
- A `code_block` with non-empty `host` + `detail` verifies directly (it is the
  agent's structured, checkable statement of the affected host and issue — the
  form the operator asked for when a single tool run is not the proof).

**The loop upgrade.** `agent.live.ts` today streams the reply, then **after
`done`** regex-parses `SKILL_CALL[...]` directives and runs them — tool results
never return to the model, so it cannot react to them. M3c replaces this with a
**bounded tool-result → model continuation loop**:

```
model turn → parse SKILL_CALL[...] → run skills (emit tool_call / finding events)
           → feed each skill's result back into the model's context
           → model turn continues … until no skill calls remain or STEP_CAP hit
```

This lets the agent self-correct within one operator turn:

```
model: SKILL_CALL[log_finding|title=Public S3 bucket|sev=high|rationale=...]
main → model: "logged UNVERIFIED (id f_3) — attach evidence"
model: SKILL_CALL[attach_evidence|finding=f_3|tool_output=tc_7]
main → model: "f_3 now verified"
model: done
```

**Decision (locked):** keep M3b's `SKILL_CALL[...]` **text protocol** and wrap
it in the continuation loop — minimal blast radius, consistent with M3b. A
rewrite to native AI-SDK tool-calling is a possible later cleanup, **not** M3c.
The loop is bounded by a `STEP_CAP` (guards runaway loops and cost); reaching
the cap ends the turn with whatever findings exist (unverified ones stay
flagged). Reuse the M3a cancel path so the loop is interruptible mid-flight.

## 4. AgentEvent contract change (`agent.types.ts`)

The `finding` event (`agent.types.ts:16`) grows to carry the full finding and
becomes an **upsert keyed by `id`**, so an unverified finding can transition to
verified in place rather than duplicating:

```ts
| { type: 'finding'; id: string; title: string; sev: Severity; phase: string
    time: string; rationale: string; evidence: Evidence[]; verified: boolean }
```

`src/ipc.ts:applyEvent` maps this to an **upsert** dispatch; the reducer's
`appendFinding` becomes `upsertFinding` (insert by new `id`, else replace the
matching row in place). No new event type is needed — the same `finding` event
carries both the initial (unverified) and updated (verified) states.

## 5. Persistence (`store.sqlite.ts`)

Pull a slice of M4 forward: add **`findings`** and **`evidence`** tables
alongside the existing `settings`/`secrets`/`scope`, on the existing migration
runner. Evidence survives restart, so a finding's artifact stays checkable after
the app reopens.

```
findings(id PK, chat_id, title, sev, phase, time, rationale, verified)
evidence(id PK, finding_id FK→findings.id, kind, tool_call_id, excerpt, host, detail)
```

- `findings.chat_id` is a **plain column** now (the companies/engagements/chats
  tables do not exist in sqlite yet — they live in the mock boot snapshot). When
  **M4** lands that schema it adds the parent tables + foreign keys and
  reconciles; M3c's shapes are chosen so this is an additive migration, not a
  rewrite.
- The captured-run stdout registry (§3) stays **in-memory** — the durable record
  is the snapshotted `excerpt` on the `evidence` row, so a resolved
  `tool_output` remains viewable after restart even though the live registry is
  gone.
- `image` evidence rows are schema-tolerated (nullable columns) but not written
  in M3c.

## 6. UI (`ContextPanel.tsx`)

- Findings list moves from **index-keyed to stable `id` key** (resolves the
  standing index-key on the render block).
- Each row gains a **verified / unverified badge** and **expands** to show the
  severity `rationale` and its evidence artifacts:
  - `tool_output` → the excerpt in a code block, labelled with the source tool.
  - `code_block` → the affected `host` + `detail`.
  - `image` → not rendered in M3c.
- An **unverified** finding reads as visibly incomplete (badge + muted state) so
  the operator can see the agent still owes evidence.
- Built in the existing visual language, **icon-light per `CLAUDE.md`** (no
  design-reference glyph to copy — new functional UI). Operator can **view**
  evidence; operator-authored evidence is deferred.

## 7. IPC / preload (`window.nexra`)

- `findings`: `list(chatId)` for boot/rehydrate (returns findings + their
  evidence, including snapshotted excerpts). Findings otherwise arrive live via
  the existing `agent:event:<chatId>` channel as `finding` upsert events.
- No secret/value surface is touched; evidence excerpts are tool **stdout**,
  never credentials (the typed-skill boundary from M3b already keeps secrets out
  of tool output).

## 8. Two internal phases (mirrors M3b-1/-2)

- **M3c-1 — substrate.** Extended `Finding`/`Evidence` types, sqlite
  `findings`+`evidence` tables + migration, reducer `upsertFinding`,
  `ContextPanel` badge + expandable evidence view, `findings` IPC. **Fully
  testable with synthetic findings — no agent changes.** The de-risking slice:
  findings (with evidence + verified status) persist across restart and render
  richly before any agent wiring exists.
- **M3c-2 — agent path.** `log_finding`/`attach_evidence` typed skills, the
  captured-run registry + `tool_output` ref resolution, the bounded
  continuation loop in `agent.live.ts`, verified/unverified enforcement. The
  agent autonomously logs an evidence-backed finding end-to-end and
  self-corrects when it forgets evidence.

The **verification mechanism** — "verified is computed in main from a resolving
artifact, never from the model" — is provable in M3c-2 with a deterministic
model stub and a fake captured run, before any real AWS tool is needed.

## 9. Testing (Vitest — pure-vs-native split, mirroring M3a/M3b)

- **types + reducer** — `upsertFinding` inserts by new `id` and replaces in
  place by existing `id`; an unverified finding transitions to verified without
  duplicating; stable `id` render key.
- **`store.sqlite.ts`** — findings + evidence roundtrip; migrating an existing
  `settings`/`secrets`/`scope` DB adds the new tables without data loss; a
  resolved `tool_output` excerpt survives a reopen.
- **`agent.tools.ts`** — `log_finding` without evidence → `verified:false` +
  needs-evidence result; `attach_evidence` with a `tool_output` ref present in
  the registry → `verified:true` with the excerpt snapshotted; an unresolvable
  ref → stays `verified:false`; a `code_block(host, detail)` → `verified:true`;
  the model cannot set `verified` directly.
- **`agent.live.ts` loop** — with a deterministic model stub: log → needs
  evidence → attach → verified → done; the `STEP_CAP` bounds the loop and ends
  the turn cleanly; abort mid-loop finalizes with `done` (reuse M3a's abort
  test).
- **IPC roundtrip** — `finding` upsert event → `applyEvent` → reducer;
  `findings.list` rehydrates evidence excerpts.
- **`ContextPanel`** — renders verified and unverified states, the excerpt, and
  the code-block host/detail; stable-key list.

`tsc --noEmit` + `npm run build` clean; all prior tests green.

## 10. Acceptance

- **M3c-1:** a finding created through a dev/test path renders with a
  verified/unverified badge, expands to show its `rationale` and evidence, and
  **survives an app restart** (sqlite) with its evidence excerpt intact.
- **M3c-2:** in an AWS config-review chat, the agent runs a tool, logs a finding
  **referencing that tool's output**, and it surfaces **verified** with the
  excerpt as evidence; a finding logged **without** evidence surfaces
  **unverified** and the agent **self-corrects within the same turn** to attach
  evidence. Every verified finding has a checkable artifact behind it, not the
  model's assertion. *(A full run needs the AWS pack installed + an account —
  the plan's "Done when"; the mechanism is provable earlier with a stub.)*

## 11. Risks

- **Loop cost / runaway** — the continuation loop multiplies model turns per
  operator message. Mitigated by `STEP_CAP` and the reused cancel path;
  unverified findings at the cap stay flagged rather than blocking.
- **Excerpt bounding** — a raw tool run can be large; the snapshotted `excerpt`
  must be bounded so evidence stays reviewable and the DB stays small. Excerpt
  size is a spec-time constant to set in the plan.
- **M4 reconcile** — pulling `findings` persistence forward front-runs M4's
  engagement schema; the `chat_id`-as-plain-column choice keeps that an
  additive migration, but M4 must own the FK wiring (called out here so it is
  not a surprise).
- **`SKILL_CALL` in streamed prose** — the model may emit a directive mid-text;
  the parser already tolerates this (M3b), and the loop treats any parsed call
  as a step. Native tool-calling would remove the ambiguity — deferred.

## 12. Process & references

Built with the locked process: this spec → `superpowers:writing-plans` →
`superpowers:subagent-driven-development` (per-task implementer + reviewer, fix
loops, final whole-branch review) → `superpowers:finishing-a-development-branch`.

- Milestone plan: `docs/superpowers/specs/2026-07-02-nexra-internal-usable-plan.md`
- M3a spec: `docs/superpowers/specs/2026-07-02-nexra-m3a-live-agent-design.md`
- M3b spec: `docs/superpowers/specs/2026-07-02-nexra-m3b-agent-exec-design.md`
- Competitive requirements: `docs/superpowers/specs/2026-07-02-competitive-requirements.md`
- Handover: `docs/superpowers/HANDOVER.md`
- App: `nexra/`
