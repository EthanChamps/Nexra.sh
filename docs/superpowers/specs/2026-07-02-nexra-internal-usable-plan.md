# Nexra.sh — Path to Internal-Usable

**Date:** 2026-07-02
**Status:** Approved (roadmap-level plan; feeds per-milestone specs)
**Supersedes for the internal-use goal:** the tail of
`2026-07-01-redcell-shipping-roadmap.md` (M3–M6). This document re-scopes that
roadmap around a single, verified goal — running a real engagement internally —
and folds in `2026-07-02-competitive-requirements.md`.

## Goal: what "internally usable" means

Locked decisions (with the user, 2026-07-02):

- **Audience:** internal — you and your team, on real engagements. Not
  distributed.
- **First vertical:** **AWS config review**, made fully real end-to-end before
  any other engagement type.
- **Packaging bar:** **dev/unsigned local build** is acceptable — no public
  signing/notarization on the critical path.
- **Data:** **local per-machine** SQLite. No server, no sync.
- **Execution model:** fully ungated (locked architecture), but with the
  safety substance the competitive doc requires designed in, not bolted on.

**Definition of done (internal-usable):** on your own Mac and Windows machines,
you can run a complete **AWS config review** engagement end-to-end — a live
Claude agent that autonomously runs the AWS audit toolchain against an account
you control, logs findings each backed by a checkable evidence artifact,
enforces scope below the model, stays watchable and interruptible, persists the
whole engagement across restarts, and exports a client-usable report — after a
security self-review and one real run against a known AWS account.

The other four engagement types come *after* this vertical proves the
architecture; they are explicitly out of scope for the first internal release.

## Verified current state (2026-07-02)

M1 (UI shell) + M2 (real terminals) complete and merged. **56 tests green**,
`tsc --noEmit` + `npm run build` clean.

| Service | State | Detail |
|---|---|---|
| `ShellService` | **real** | node-pty operator terminals + xterm.js. Agent does **not** drive them yet ("Shared with agent" is a visual-only pill). Cross-platform *manual* dogfood still outstanding. |
| `AgentService` | **mock** | `runSend`/`runInstall` emit canned text/tool_call/finding/done on timers. No model calls. |
| `StoreService` | **mock, read-only** | `store:snapshot` loaded once at boot; **nothing survives restart**. No write path exists. |
| Settings | **inert** | provider/model/API-key are component-local `useState`, saved nowhere, used by nothing. No keychain code anywhere in the repo. |

**IPC gaps a live agent must close** (`electron/preload.ts`, `electron/main.ts`):
no cancel/interrupt channel, no provider-config channel, no secrets storage, no
store-write channel.

**The M3 seam is clean:** swap `runSend`/`runInstall` in `main.ts:42-43` for a
real provider client. The `AgentEvent` union (`text|tool_call|finding|done`),
the per-chat `agent:event:<chatId>` channel scheme, and the renderer translator
`src/ipc.ts:applyEvent` can all stay — the mock already emits exactly the events
the renderer consumes.

## Competitive-requirements coverage

This plan is checked requirement-by-requirement against
`2026-07-02-competitive-requirements.md`. The bar that document sets is met for
the AWS vertical as follows; every deferred item is deferred deliberately, not
overlooked.

| # | Requirement | v1 (AWS) | Where |
|---|---|---|---|
| 1 | Real multi-phase tool execution | Met | M3b — Prowler/ScoutSuite/PMapper across all four AWS phases, each actually executing before the phase is claimed |
| 2 | Orchestration + persistent memory | Met (scoped) | Typed tool/skill layer (M3b) + phase-coverage tracker + external memory (M4). Attack-tree planning & multi-agent deferred — see below |
| 3 | Validation before a finding | Met | M3c — evidence artifact required before a finding surfaces |
| 4 | Scope enforcement + prompt-injection defense | Met | M3b — account/region allowlist enforced below the LLM by the typed-tool layer; tool output treated as untrusted data; cleanup registered before actions |
| 5 | Tool depth per engagement type | Met for AWS | AWS pack wired end-to-end; other four types deferred (not claimed until real, per Req 8) |
| 6 | Supervised autonomy | Met | M3b — phase checkpoints, mid-run interrupt, live dock mirror |
| 7 | Findings → client report | Met | Phase 5 — report export |
| 8 | Independently checkable claims | Met | Phase 6 — real run against a known AWS account before the vertical is called done |

**Decisions taken (2026-07-02):**

- **Typed tool/skill layer, not freeform shell, for the agent (Req 2a).** The
  agent's execution path is a defined set of skills (`run_prowler`,
  `run_scoutsuite`, `run_pmapper`, …) with typed arguments — still *ungated*
  (no per-command approval prompt, consistent with the locked model). This is
  what makes below-the-LLM scope enforcement (Req 4) tractable: an
  account/region argument can be validated and denied at the tool boundary,
  whereas an arbitrary shell command cannot. The operator keeps unrestricted
  freeform shell in the dock; the *agent* does not.
- **Attack-tree planning module + multi-agent orchestration deferred to the
  pentest verticals (Req 2b).** AWS config review is coverage-driven (fixed
  phases, fixed tools), so its planning analog is a lightweight **phase-coverage
  tracker** (which checks/phases are done, what's outstanding) built on M4's
  memory — not an attack-tree planner or an agent swarm. Those land with
  internal/external pentest, where escalation and chaining actually need them.

**Standing guardrail (competitive non-requirements).** Nexra makes no "zero
false positives" or "fully autonomous across all phases" claims — the research
shows both are untrue industry-wide and are a specific reputational risk. Every
capability claim is tied to a real run (Req 8); the AWS vertical is the only one
claimed for the first internal release.

**AWS-specific nuance:** the AWS pack (Prowler/ScoutSuite) is read-oriented
against the cloud control plane, so Req 4's cleanup/rollback is mostly about the
*operator's* environment (killing runaway scans, disposing of temporary
credentials), not mutating a target — another reason AWS is the safe first
vertical.

## The critical path

Ordered milestones. Each is one development branch built with the locked
process (brainstorm → spec → plan → subagent-driven-development → merge).

### Phase 1 — M3a: Live conversational agent (foundation)

Make the chat real, without tool execution yet. Smallest change that turns the
mock into a live model.

- Add the Vercel AI SDK v6 (`ai` + `@ai-sdk/anthropic`; other providers later).
- Replace `agent.mock`'s `runSend`/`runInstall` with a real streaming agent in
  the main process. Keep the `AgentEvent` contract, IPC channel scheme, and
  `applyEvent` unchanged.
- Thread provider/model into the agent request (today `AgentSendRequest` carries
  no provider/model/key — `agent.types.ts:9`).
- Add an **`agent:cancel` IPC channel** (none exists) and make the agent run
  abortable.
- Make **Settings real**: persist provider/model/baseURL (add a store-write
  path), and store the **API key in the OS keychain** (Electron `safeStorage`,
  or `keytar`) — never plaintext, never in `process.env` where it could leak
  into the operator shells (see the standing warning at `shell.pty.ts:35`).
- Add the **composer busy-lock** (new `busy` field in `UIState`; disable send
  while streaming) and an **interrupt button** wired to `agent:cancel`.
- Tests: the full renderer↔IPC agent round-trip (currently untested), Settings
  persistence, keychain read/write (mocked).

*Done when:* you can hold a real Claude conversation in a chat, choose
provider/model, have the key stored securely, and stop a stream mid-flight.

### Phase 2 — M4: Persistence + external memory (local, per-machine)

Can begin as soon as M3a settles the message shape; overlaps M3b/M3c.

- `better-sqlite3` in `StoreService`, DB in the app's `userData` dir.
- Schema for companies/engagements/chats/messages/findings; a **store-write
  IPC path** (mutations persist, not just the boot snapshot).
- Load real data on boot; keep the seed for first-run/dev only.
- Schema-migration test (old data loads into new schema).
- **External per-chat memory** (competitive Req 2c): a queryable structure for
  "targets tried / dead ends / findings", retrievable across an engagement's
  chats (recon feeding exploitation) — designed as structure, not a longer
  transcript. Schema designed now even if fully populated during M3b.
- **Phase-coverage tracker** (the config-review analog of competitive Req 2b's
  planning module): a lightweight record of which phases/checks are done and
  what's outstanding, built on the memory above. This is what a coverage-driven
  engagement needs instead of an attack-tree planner — which, with multi-agent
  orchestration, is deferred to the pentest verticals.

*Done when:* engagements survive restart and a long phase doesn't degrade as
its transcript grows.

### Phase 3 — M3b: Agent-driven AWS auditing (the first real vertical)

The agent drives real tools, ungated, with safety designed in from the start.

- Define the **typed tool/skill layer** (competitive Req 2a): the agent's
  execution path is a defined set of skills (`run_prowler`, `run_scoutsuite`,
  `run_pmapper`, …) with typed arguments, each streaming output back as
  `tool_call` events. Still ungated (no approval prompts); the operator keeps
  freeform shell in the dock, the agent does not get it. The typed arguments are
  exactly what the scope allowlist below validates.
- Wire the **AWS tool pack** end-to-end across the four AWS phases (IAM,
  Storage/S3, Network/VPC, Logging): **Prowler, ScoutSuite, PMapper**, actually
  executing against an AWS account (credentials sourced from the keychain, not
  baked into operator-shell env).
- **Safety, as architecture (competitive Req 4) — not an M6 checklist:**
  - **Scope allowlist enforced below the LLM**, at the tool-execution boundary:
    for AWS, scope = allowed account IDs / regions. Tool invocations targeting
    out-of-scope accounts are denied by the execution layer regardless of what
    the model asks for.
  - **All tool/target output is untrusted data, never instructions** when it
    re-enters the agent's context (prompt-injection defense).
  - **Cleanup/rollback registered before any action runs**, so a crash, SIGINT,
    or runaway session leaves neither the target nor the operator environment in
    a bad state.
- **Supervised autonomy (competitive Req 6):** agent self-checkpoints and
  reports at phase boundaries; the run stays interruptible mid-flight (reuse the
  M3a cancel path); execution mirrors into the shared dock so the operator
  watches live.

*Done when:* in an AWS config-review chat, the agent autonomously runs
Prowler/ScoutSuite/PMapper and streams real output; scope is enforced below the
model; you can watch and interrupt.

### Phase 4 — M3c: Finding validation + evidence (competitive Req 3)

- Extend `Finding` (`store.types.ts:25`, currently only `{title,sev,phase,time}`)
  with an `id`, an `evidence` artifact reference (captured tool output / re-run
  PoC / control-plane response), and a severity `rationale`.
- Update the `finding` AgentEvent, `appendFinding`, and the `ContextPanel`
  render block (add a stable id key — rows are index-keyed today).
- The agent must **attach evidence before a finding surfaces** — for AWS, the
  raw tool output / API response proving the misconfiguration.

*Done when:* every surfaced finding has a checkable artifact behind it, not just
the model's assertion.

### Phase 5 — Report export (competitive Req 7)

- Findings across an engagement's chats → a structured, client-usable report
  (Markdown/HTML → PDF). New milestone; not on the original roadmap.

*Done when:* a completed AWS engagement produces a document you could hand to a
client.

### Phase 6 — Hardening + dogfood + packaging (the internal-usable gate)

- `/security-review` focused on the ungated-exec + key-handling +
  prompt-injection surface (much of the substance already landed in M3b).
- Close the **M2 manual terminal dogfood** on both macOS and Windows (still
  outstanding from M2 — see HANDOVER "Known gap").
- One real run against a **known AWS account / benchmark** (competitive Req 8) —
  evidence the vertical works, not a description of it.
- **Minimal packaging:** confirm `npm run dev` and a locally-built unsigned app
  run on the team's Macs + Windows; document the one-time Gatekeeper/SmartScreen
  bypass. Bump `electron-builder` to `^26` only if/when a local `.dmg`/`.exe` is
  actually built (kills the `node-tar` advisory; re-check interaction with
  node-pty's native prebuild/asar unpacking at that point). **Public
  notarization is explicitly deferred** — not needed for internal use.

*Done when:* the internal-usable definition above is met.

## Key design decisions to resolve at spec time

Flagged here so they get real design in the relevant milestone spec rather than
being assumed:

1. **Agent execution channel (M3b):** does the agent drive the *same*
   interactive pty the operator shares, or a *separate captured-exec* channel
   (agent gets stdout/exit code to reason over) that is *mirrored* into the
   visible dock? Leaning separate-capture-with-mirror — interactive ptys are
   built for humans, and the agent needs structured results — but this is a real
   M3b decision.
2. **Scope-enforcement mechanism (M3b):** exactly how the execution layer
   validates an AWS tool invocation's target account/region against the
   allowlist and denies otherwise. More tractable for AWS (wrap invocations,
   validate/inject account+region guards) than for the pentest types later — a
   reason AWS goes first.
3. **External-memory shape (M4):** the concrete queryable schema for
   cross-chat findings/targets, versus just a longer stored history.

## Explicitly de-scoped for the first internal release

- The other four engagement types (Azure/M365 config review, internal/external
  pentest) — after the AWS vertical proves the architecture. Pentest types carry
  a sharply higher safety bar (live-host exploitation, acute
  prompt-injection-from-target, scope-escape) and should not be first.
- **Attack-tree/task-difficulty planning module and multi-agent orchestration**
  (competitive Req 2b) — deferred to the pentest verticals; v1 config review
  uses a single agent + the phase-coverage tracker (M4) instead.
- Public code signing / Apple notarization / distributable installers.
- Multi-user / shared engagement data / sync.
- Any custom or fine-tuned model, and any benchmarked marketing claims
  (competitive non-requirements).

## Sequencing summary

```
M3a (live agent) ──► M4 (persistence, overlaps) ──► M3b (AWS exec + safety)
      └────────────────────────────────────────────► M3c (evidence, overlaps M3b)
                                                              │
                                              Report export ──┘
                                                              │
                                   Hardening + dogfood + packaging ──► INTERNAL-USABLE
```

## Process & where things live

Process unchanged (per `CLAUDE.md`): `superpowers:brainstorming` → spec
(`docs/superpowers/specs/`) → `superpowers:writing-plans` → plan
(`docs/superpowers/plans/`) → `superpowers:subagent-driven-development`
(per-task implementer + reviewer, fix loops, final whole-branch review) →
`superpowers:finishing-a-development-branch`. One spec per milestone, written
just-in-time as each is started.

- This plan: `docs/superpowers/specs/2026-07-02-nexra-internal-usable-plan.md`
- Competitive requirements: `docs/superpowers/specs/2026-07-02-competitive-requirements.md`
- Prior roadmap: `docs/superpowers/specs/2026-07-01-redcell-shipping-roadmap.md`
- Handover / current status: `docs/superpowers/HANDOVER.md`
- App: `nexra/`
</content>
