# Nexra.sh — Handover

**Date:** 2026-07-03
**Status:** M1 + M2 + M3 (a–d) merged to `master`. **M4 complete, in review — draft PR #26** (`worktree-nexra-m4-persistence`), not yet merged.

> The app was renamed **Redcell → Nexra.sh** partway through. App dir is
> `nexra/`, IPC is `window.nexra.*`, vendored design reference is
> `nexra/design-reference/Nexra.dc.html`. Some historical sections below use
> the old name where they describe what was literally built at the time.

## What Nexra.sh is

Cross-platform (macOS + Windows) Electron desktop app: an AI-agent console for
security consultants. Hierarchy: **Project/Company** (client) → **Engagement**
(one of 5 fixed review types) → **Chat** (a focused agent thread per phase, its
own context/findings/tools). Each chat streams assistant text, runs typed
skills (shown as tool-call cards), logs findings backed by evidence, and shares
a bottom terminal dock (PowerShell / cmd / Kali-WSL) with the operator.

**First vertical being made fully real: AWS config review.** The other four
engagement types come after it proves the architecture (see the roadmap doc).

## The plan of record

The single source of truth for sequencing is
**`docs/superpowers/specs/2026-07-02-nexra-internal-usable-plan.md`** — it
re-scopes the older shipping roadmap around one goal: running a real AWS
config-review engagement internally, end-to-end. Read it first.

Critical path (✅ = merged, 🟡 = done but in review, ⬜ = not started):

```
M3a live agent ✅ ─► M4 persistence 🟡(PR #26) ─► M3b AWS exec+safety ✅
      └──────────────────────────────────────────► M3c evidence ✅
        (+ M3d agent-requested inputs ✅)
                                    Phase 5 report export ⬜
                                    Phase 6 hardening/dogfood/packaging ⬜ ─► INTERNAL-USABLE
```

Note the milestone numbering drifted from the plan: git's "m3b" branch was the
**credential vault**, while the plan's "M3b" is **AWS tool execution** — both
are done. What matters is the state below, not the labels.

## Verified current state (2026-07-03)

| Service / area | State | Detail |
|---|---|---|
| `ShellService` | **real** | node-pty operator terminals + xterm.js (M2). |
| `AgentService` | **real** | Vercel AI SDK v6 + Claude, streaming, cancel, bounded tool loop (M3a). |
| Typed skill layer | **real** | `run_prowler`/`run_scoutsuite`/`run_pmapper` in `agent.tools.ts`; scope validated below the LLM; creds injected into the child process (agent never sees them). Actual tools must be installed on the box to run for real. |
| Credential vault | **real** | encrypted secrets in sqlite; `secrets.vault.ts` / `secrets.ts`. |
| Findings + evidence | **real** | evidence required before a finding is `verified`; persisted (M3c). |
| Agent-requested inputs | **real** | input/scope/skill request cards + manual Continue button (M3d). |
| `StoreService` (graph persistence) | **done, in PR #26** | companies/engagements/chats/messages now persist to sqlite and survive restart; `phase_coverage` + `engagement_memory` substrate. **On `master` this is still the read-only mock seed until #26 merges.** |
| Settings | **real** | provider/model persisted; API key in encrypted store (M3a). |

**Tests:** on the M4 branch, `npm test` = **206/206 green**, `npm run build`
(`tsc` + `vite build`) clean. On `master` (pre-#26): the smaller pre-M4 suite.

## Immediate next actions (for the next agent)

1. **Merge PR #26** (M4 persistence) after review — it's the last mock backend
   (`StoreService`) going real. Nothing else should build on `master` until
   this lands, or you'll re-derive the message/graph shape. Branch:
   `worktree-nexra-m4-persistence`. Spec + plan:
   `docs/superpowers/{specs,plans}/2026-07-03-nexra-m4-persistence*.md`.

2. **Phase 5 — Report export** (new milestone, not yet specced). Findings
   across an engagement's chats → a structured, client-usable report
   (Markdown/HTML → PDF). *Done when:* a completed AWS engagement produces a
   document you could hand to a client. Follow the locked process (brainstorm →
   spec → plan → subagent-driven-development → finishing-a-development-branch).

3. **Phase 6 — Hardening + dogfood + packaging** (the internal-usable gate).
   Three bundled pieces:
   - **Hardening:** `/security-review` focused on the ungated-execution +
     key-handling + prompt-injection surface (much substance already landed in
     M3b — this is the review that confirms it holds). Non-negotiable *because*
     execution is ungated.
   - **Dogfood:** (a) close the **outstanding M2 manual terminal dogfood** on
     macOS + Windows — never done interactively (built headless); see "Known
     gaps" below. (b) **One real AWS run** against a known account/benchmark:
     the agent autonomously runs Prowler/ScoutSuite/PMapper, logs findings with
     evidence, enforces scope — proof, not a description (competitive Req 8).
   - **Packaging:** confirm `npm run dev` + a locally-built **unsigned** app run
     on the team's Macs + Windows; document the one-time Gatekeeper/SmartScreen
     bypass. Bump `electron-builder` to `^26` only if/when a local `.dmg`/`.exe`
     is actually built (kills the `node-tar` advisory; re-check vs node-pty's
     native prebuild/asar unpacking). **Public signing/notarization is
     explicitly deferred** — not needed for internal use.

*Done when Phase 6 closes:* you can run a complete AWS config-review engagement
end-to-end on your own Mac and Windows, after a security self-review and one
real run. That is the internal-usable definition of done.

## Locked architecture decisions

- **Electron** + React/Vite renderer (not Tauri) — needs real interactive PTYs.
- **AI: provider-agnostic** via Vercel AI SDK v6; Claude default.
- **Execution model: real, UNGATED** — the agent runs skills with no
  per-command approval. Safety is designed in below the LLM (typed skill layer,
  scope allowlist at the tool boundary, tool output treated as untrusted data,
  credentials injected into the child process only), not a per-command prompt.
- **Service boundary:** `electron/services/*` exposed via `contextBridge` as
  `window.nexra.*`. **No renderer component imports a service directly** — real
  backends swap in with zero UI changes. This is why each milestone replaces
  exactly one backend.
- **Styling source of truth:** vendored prototype
  `nexra/design-reference/Nexra.dc.html` — match hex/px exactly.
- **Icons are for action/status, not decoration** — don't add UI the reference
  doesn't have (e.g. M4 deliberately ships memory/coverage as backend-only, no
  new UI).
- **Persistence (M4):** two writers split by origin — the **renderer
  debounce-autosaves** structure + transcript (`store.save`), the **main
  process** owns event-originated data it already emits (findings, plus new
  `phase_coverage`/`engagement_memory`). Schema is additive-only in
  `initSettingsDb`; an older DB upgrades in place.

## Known gaps / deferred (triaged)

- **M2 cross-platform manual dogfood still outstanding** — real prompts,
  `sudo`/`less`/Ctrl-C, long-running-command-survives-dock-close/reopen, no
  orphaned processes on quit, and (macOS) the window close/reopen live-stream
  path. Built in a headless job with no display; a human must walk the M2
  checklist on both OSes. **Folds into Phase 6 dogfood.**
- **Phase 5 (report export) and Phase 6 (hardening/dogfood/packaging)** not yet
  started — see "Immediate next actions".
- **External memory is storage substrate only** — the agent *using* memory to
  bound its context (so a long phase doesn't degrade as its transcript grows)
  is a follow-on in the agent loop, not M4.
- **Other four engagement types** (Azure/M365 config, internal/external pentest)
  deferred until the AWS vertical proves out. Pentest types carry a sharply
  higher safety bar and should not be first.
- **Attack-tree planning + multi-agent orchestration** deferred to the pentest
  verticals; AWS uses a single agent + the phase-coverage tracker.
- Dev-only: `electron-builder ^24` pulls a vulnerable transitive `node-tar`
  (bump at packaging time); a harmless "CJS build of Vite's Node API is
  deprecated" stderr line appears on every vitest/build run.

## How to run it

```bash
cd nexra
npm install       # runs postinstall (fixes node-pty's spawn-helper permissions)
npm run dev       # launches the Electron app (needs a display)
npm test          # Vitest (206 on the M4 branch)
npm run build     # tsc + vite build
npm run dist      # electron-builder (scaffolded only — unverified/unsigned)
```

## Process (mandated by CLAUDE.md, every milestone)

`superpowers:brainstorming` → spec (`docs/superpowers/specs/`) →
`superpowers:writing-plans` → plan (`docs/superpowers/plans/`) →
`superpowers:subagent-driven-development` (implementer + reviewer subagent per
task, fix loops on findings, final whole-branch review) →
`superpowers:finishing-a-development-branch`. One spec per milestone, written
just-in-time.

## Where things live

- **Roadmap / plan of record:** `docs/superpowers/specs/2026-07-02-nexra-internal-usable-plan.md`
- Competitive requirements: `docs/superpowers/specs/2026-07-02-competitive-requirements.md`
- Prior shipping roadmap (superseded for internal goal): `docs/superpowers/specs/2026-07-01-redcell-shipping-roadmap.md`
- Per-milestone specs + plans: `docs/superpowers/specs/`, `docs/superpowers/plans/`
- M4 spec + plan: `docs/superpowers/{specs,plans}/2026-07-03-nexra-m4-persistence*.md`
- App: `nexra/` (see `nexra/README.md`)
- This handover: `docs/superpowers/HANDOVER.md`
</content>
