# Redcell — Handover

**Date:** 2026-07-02
**Status:** M1 (UI shell) + M2 (real terminals) complete, reviewed, merged to `master`.

## What Redcell is

A cross-platform (macOS + Windows) desktop app for security consultants: an
AI-agent console for running security engagements. Hierarchy: **Project**
(client) → **Engagement** (one of 5 fixed review types, each with fixed
phases/tools/scope) → **Chat** (a focused agent thread per phase, its own
context/findings/tools). Each chat streams assistant text, runs tools (shown
as tool-call cards), logs findings, and shares a bottom terminal dock
(PowerShell / cmd / Kali-WSL) with the operator.

Source of visual/behavioural truth: the imported Claude Design prototype
`Redcell.dc.html` (project `3894fbba-5f50-4469-a73a-6c9f110f36d7`), vendored
verbatim at `redcell/design-reference/Redcell.dc.html`.

Note: the project was renamed **Redcell → Nexra.sh** partway through (see
`CLAUDE.md`); the app directory is now `nexra/`, IPC is `window.nexra.*`, and
the vendored reference is `nexra/design-reference/Nexra.dc.html`. This
document's historical sections below predate the rename and use the old
names where they describe what was literally built at the time.

## Locked architecture decisions

- **Electron** + React/Vite renderer (not Tauri) — chosen for `node-pty` +
  `xterm.js`-class interactive shells (PowerShell/cmd/WSL/bash) and easy
  provider-agnostic AI in Node.
- **AI: provider-agnostic**, via the **Vercel AI SDK v6** (planned for M3).
  Claude (Anthropic) is the default/first-wired provider; OpenAI/Google/Ollama
  are selectable in Settings and trivially addable.
- **Target execution model: real, UNGATED.** The agent will eventually run
  commands autonomously with no per-command approval gate. M2 delivers real,
  ungated *operator* terminals; the agent itself doesn't drive the shell yet
  (M3).
- **M1 scope = UI shell only.** No real execution, no live LLM, no disk
  persistence — all three backends were mocks behind clean service interfaces.
- **M2 scope = real terminals.** `ShellService` is now backed by real
  `node-pty` processes; `AgentService`/`StoreService` are still mocks.

## What was built (M1)

Electron + React (Vite) app in `redcell/`. Three mock-backed services in
`electron/services/` (`StoreService`, `AgentService`, `ShellService`), exposed
to the renderer via a `contextBridge` preload as `window.redcell.*`. **No
renderer component imports a service directly** — everything flows through
that IPC boundary, so real backends can replace the mocks with zero UI
changes.

Screens/components (all pixel-ported from the reference, exact hex/px):
Home (projects grid + New Project modal), Workspace (sidebar with nested
chats, chat pane with message list + 3 tool-card states + composer), right
context panel (Scope/Findings/Tools) + collapsed rail, New Engagement / New
Chat modals, chat right-click context menu, a resizable shared terminal dock
(3 shells, Ctrl+`` toggle), and an inert Settings screen (provider/model/API
key — Claude-default, nothing wired to a real network call).

State: a ported `reducer.ts`/`selectors.ts` (mirrors the prototype's
`DCLogic` class) driving all screens via `useReducer`.

**Result:** 20/20 tests passing, `npm run build` + `tsc --noEmit` clean.
Whole-branch review verdict: **ready to merge, no Critical/Important issues**.

Notable bugs caught and fixed during review (not left in the codebase):
1. **Reducer `clone()` aliasing bug** — the plan's own code shallow-copied
   `ui`, leaving `activeChatByEngagement`/`ctxMenu` shared across states.
   Fixed to deep-clone those two nested collections.
2. **Duplicate install-card bug** — clicking "Install" on an unavailable tool
   appended a new tool card instead of transforming the clicked card in
   place (prototype mutates the same message). Fixed by seeding the
   running-card id map with the clicked card's own id; added a regression
   test (`upsertToolCard` replace-in-place).
3. Several exact-alpha CSS fidelity drifts (`theme.border2` `0.1` used where
   the reference specified `0.09`, in Home cards/chips and two modal
   elements) — all found by review and corrected to literal values.

## What was built (M2)

`ShellService`'s mock (`electron/services/shell.mock.ts`, request/response
`run`/`prompt` over a line-model) is gone, replaced end-to-end by real
interactive PTYs:

- **`node-pty`** spawns real shells: PowerShell/cmd/WSL-Kali on Windows,
  the operator's login shell (or `pwsh` if installed) on macOS. Its 1.x
  releases ship **N-API prebuilt binaries** for darwin-arm64/x64 and
  win32-x64/arm64 — confirmed by inspecting the published tarball — so no
  `electron-rebuild`/ABI-rebuild step is needed; the same prebuild loads
  under both plain Node (Vitest) and Electron's embedded Node. The one real
  install-time snag: the prebuilt `spawn-helper` binary loses its executable
  bit via npm, fixed with a `postinstall` script
  (`nexra/scripts/fix-native-permissions.cjs`) that restores it.
- **Session registry** (`electron/services/shell.pty.ts`) keeps one real pty
  process per shell tab, keyed by `ShellId` — lazily created on first view,
  and idempotent (`create()` on an already-running shell returns its current
  state instead of spawning a second process). This is what makes sessions
  survive the dock closing: the pty keeps running in the main process
  regardless of whether `TerminalDock` is mounted; reopening the dock just
  re-attaches. All sessions are force-killed on `app.on('before-quit')`, and
  killing a session is verified (in tests) to actually end the OS process,
  not just drop a map entry.
- **Bounded scrollback** (`electron/services/scrollback.ts`) — an in-memory,
  byte-capped ring buffer per session (default 5MB), replayed into a
  reattaching `TerminalDock` so a reopened dock repaints recent output
  instead of starting blank.
- **Platform-resolved shell tabs** (`electron/services/shell.resolve.ts` +
  `shell.probe.ts`) — pure resolution logic (unit-tested with an injected
  probe) separated from the real, impure `which`/`wsl.exe -l -q` probing
  used at runtime. Windows always offers PowerShell + cmd, adds Kali only if
  a `kali-linux` WSL distro is detected; macOS always offers the login shell,
  adds PowerShell only if `pwsh` is on `PATH`. Unavailable shells are simply
  omitted, never shown broken.
- **Renderer: `xterm.js` + `@xterm/addon-fit`** replace the old line-by-line
  `<pre>` renderer and single-line `<input>` in `TerminalDock.tsx` — a real
  PTY is a continuous, ANSI-bearing byte stream and needs raw keystrokes
  (`sudo` prompts, `less`/`vim`, Ctrl-C, tab completion), which a buffered
  `<input>` can't drive. The dock's outer chrome (resize handle, tab bar,
  "Shared with agent" pill, close button, exact `theme.ts` colors) is
  unchanged — only the scroll-area internals were swapped, verified
  byte-for-byte against the pre-M2 file during review.
- **IPC surface** changed from request/response (`shell.run`/`shell.prompt`)
  to a session/stream model:
  `window.nexra.shell.{tabs, create, write, resize, kill, onData}` — `onData`
  is a `contextBridge`-exposed subscription over a single always-listening
  `ipcRenderer.on('shell:data', ...)` channel (main process broadcasts every
  session's output continuously; the renderer filters by `sessionId`).

**Result:** 37/37 tests passing (unit: shell resolution, scrollback
ring-buffer; real-process integration: spawn/write/resize/kill + pid-liveness
check on both the spike and the session registry; renderer: mocked-xterm
wiring tests — xterm.js itself isn't meaningfully unit-testable in jsdom, so
it's covered by manual/dogfood verification instead per the design spec).
`tsc --noEmit` and `npm run build` clean. Executed via
`subagent-driven-development`: 7 implementation tasks, each with an
independent implementer + reviewer subagent and a fix loop on findings
(three fix loops total — a non-reproducible `npm install` due to the
`spawn-helper` permission bit plus a dead-code Vitest config split on Task 1;
a `tsc` regression on Task 2 from widening `ShellId` without propagating it
to `UIState.terminalShell`; both resolved and re-reviewed clean).

**Known gap:** cross-platform manual dogfooding (per the design spec's M2
acceptance criteria — real prompts, `sudo`/`less`/Ctrl-C behaving correctly,
long-running-command-survives-dock-close/reopen, no orphaned processes on
quit) was **not performed interactively** in the environment this milestone
was built in (a headless background job with no attached display). The
automated integration tests exercise the same lifecycle claims
programmatically (real spawn, real echo, real resize, real kill verified via
`process.kill(pid, 0)`, `before-quit` wired to `killAllSessions()`), but a
human should still walk through the manual checklist in the M2 design spec
on both macOS and Windows before fully closing out this milestone. On macOS
specifically, the manual check should include closing the app window itself
(the red traffic-light button, not just the terminal dock) and reopening it
via the dock icon, then confirming a previously-running session's live
output still streams — this exercises the window/webContents-swap path that
the automated suite can't cover (no `BrowserWindow` lifecycle test).

## How to run it

```bash
cd nexra
npm install       # runs postinstall automatically (fixes node-pty's spawn-helper permissions)
npm run dev       # launches the Electron app (needs a display)
npm test          # Vitest, 37 tests
npm run build     # tsc + vite build
npm run dist      # electron-builder (scaffolded only — not verified/signed)
```

## Process used

`superpowers:brainstorming` → spec (`docs/superpowers/specs/2026-07-01-redcell-ui-shell-design.md`
for M1, `docs/superpowers/specs/2026-07-01-redcell-m0-m2-design.md` for M2)
→ `superpowers:writing-plans` → plan (`docs/superpowers/plans/2026-07-01-redcell-ui-shell.md`,
14 tasks, for M1; `docs/superpowers/plans/2026-07-02-nexra-m2-real-terminals.md`,
8 tasks, for M2) → `superpowers:subagent-driven-development`: fresh implementer
subagent per task (TDD), fresh reviewer subagent per task (spec + quality
gate, fix loop on findings) → `superpowers:finishing-a-development-branch`.

## Known limitations / deferred (not blocking, all triaged)

- **Real backends still mocked:** the Vercel AI SDK + Claude in
  `AgentService` (provider-agnostic, ungated execution), and
  `better-sqlite3` in `StoreService`.
- **No guard against overlapping agent streams** on one chat — add a
  composer busy-lock when the real agent is wired.
- The `finding` AgentEvent path is fully plumbed but unexercised (no current
  mock emits one).
- `installTool`'s id-seeding is covered only via a reducer-level test, not a
  direct `installTool` unit test — nice-to-have follow-up.
- Non-Anthropic providers in Settings show a single hardcoded model each
  (placeholder; inert by design).
- Dev-only: `electron-builder ^24` pulls a vulnerable transitive `node-tar` —
  bump to `^26` when signed installers are actually built (this also hasn't
  been re-checked for interaction with `node-pty`'s native prebuilds/asar
  unpacking, which M2 didn't need to solve since `npm run dist` remains
  unverified/scaffolded-only). Also a harmless "CJS build of Vite's Node
  API is deprecated" stderr line appears on every `vitest`/`build` run
  (Vite 5 config resolution quirk, no functional impact).
- Cross-platform manual dogfood for M2 (see "Known gap" above) is still
  outstanding.
- This file (`docs/superpowers/HANDOVER.md`) was itself untracked in git
  until M2's docs task — it now ships as a normal tracked file going
  forward.

## Where things live

- Specs: `docs/superpowers/specs/2026-07-01-redcell-ui-shell-design.md` (M1),
  `docs/superpowers/specs/2026-07-01-redcell-m0-m2-design.md` (M0 + M2)
- Plans: `docs/superpowers/plans/2026-07-01-redcell-ui-shell.md` (M1),
  `docs/superpowers/plans/2026-07-02-nexra-m2-real-terminals.md` (M2)
- App: `nexra/` (see `nexra/README.md` for architecture notes)
- Prototype reference: `nexra/design-reference/Nexra.dc.html`
- Per-task briefs/reports/review packages/progress ledger (working
  scratch, not meant to be durable): `.superpowers/sdd/` (gitignored)
- Persistent cross-session memory: see `CLAUDE.md` and the assistant's
  memory file `redcell-project.md` (outside this repo, in the assistant's
  memory store) for the same facts, kept in sync with this document.

## Next step

When ready to continue: brainstorm M3 — the agent driving the shell (the
"Shared with agent" pill goes from visual-only to real; this is also where
an overlapping-command/output-interleaving policy needs deciding), plus
`better-sqlite3` persistence and the live Claude/AI-SDK agent via the Vercel
AI SDK. Spec it, plan it, and run the same subagent-driven-development
process. Before or alongside that: close the M2 manual-dogfood gap noted
above on both target OSes.
