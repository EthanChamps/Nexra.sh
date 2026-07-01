# Redcell — Milestone 0 (Safety Net) + Milestone 2 (Real Terminals) Design

**Date:** 2026-07-01
**Status:** Approved (design), pending implementation plan
**Scope:** M0 and M2 of the shipping roadmap
(`2026-07-01-redcell-shipping-roadmap.md`)

These two milestones are specced together because M0 is small (infra) and M2 is
the first real backend. M3–M6 are specced just-in-time when reached.

---

## Milestone 0 — Safety Net

### Goal

Make the repo recoverable and give AI-authored code an independent verifier
before any real backend lands.

### M0.1 — Remote + push

- Create a private GitHub repo and add it as `origin`. Push `master`.
- No history rewrite; the existing M1 merge commit stays.

### M0.2 — Continuous integration

- GitHub Actions workflow `.github/workflows/ci.yml`.
- Matrix: `macos-latest` **and** `windows-latest` (cross-platform is a v1
  requirement, so CI must prove both from day one).
- Steps per OS: `npm ci` → `npm test` → `npx tsc --noEmit` → `npm run build`.
- Trigger on push and PR to `master`.
- Node version pinned to the version the app targets (match `redcell`'s
  Electron Node ABI line; record it in the workflow).

### M0.3 — Branch protection (lightweight)

- Require the CI check to pass before merge to `master`. Single-maintainer, so
  no required reviewers — the per-task reviewer subagent in the build process
  already covers review.

### M0 acceptance

- Fresh clone on both OSes: `npm ci && npm test && npm run build` green.
- A deliberately failing test makes CI red (verify the referee actually works).

### M0 explicitly NOT in scope

Release automation, installer builds in CI, coverage gates, semantic-release.
Those belong to M5.

---

## Milestone 2 — Real Terminals

### Goal

Replace the mock `ShellService` with real interactive PTYs (`node-pty`) so the
dock runs live PowerShell / cmd / WSL-Kali (and zsh/bash on macOS) sessions,
with session buffers that survive dock close/reopen and processes that are
killed on chat/app close.

### Key design finding: this is not a zero-UI-change swap

The M1 handover assumed backends swap "with zero UI changes." That holds for
`StoreService`/`AgentService` but **not** for shells, because the mock's
*interface itself* is mock-shaped:

- **Current interface** (`shell.types.ts` + `preload.ts`): request/response.
  `shell.run(shell, raw)` takes a whole command string and returns
  `{ lines, clear }`. The renderer (`TerminalDock.tsx`) keeps a
  `Record<ShellId, ShellLine[]>` in React state and renders each line with a
  `<pre>`, plus a single `<input>` that submits one command on Enter.
- **A real PTY is streaming and byte-oriented.** It emits a continuous UTF-8
  byte stream containing ANSI escape sequences (colors, cursor movement,
  screen clears) and must receive raw keystrokes (not whole lines) so that
  interactive programs work: `sudo` password prompts, `less`/`nano`/`vim`,
  progress bars, Ctrl-C, tab completion, arrow-key history.

A line-buffered `<input>` box **cannot** drive an interactive PTY. So M2
necessarily changes two things the mock hid:

1. **The service interface** changes from request/response to a session +
   stream model (below).
2. **The renderer terminal** changes from the custom line renderer + `<input>`
   to **xterm.js** (`@xterm/xterm` + `@xterm/addon-fit`), which is the standard
   ANSI-capable terminal emulator and what node-pty is designed to feed.

This is expected and correct — it is the mock boundary doing its job (UI
downstream of `window.redcell.shell` is the only thing that changes; screens,
reducer, and other services are untouched). It is called out here so the plan
budgets for an xterm swap rather than assuming a drop-in.

### New service interface

Replace the mock's `tabs/run/prompt` with a session/stream API. Proposed
`window.redcell.shell`:

- `tabs(): ShellTab[]` — unchanged (still lists pwsh/cmd/kali, plus the
  platform default login shell on macOS).
- `create(shell: ShellId, cols, rows): { sessionId }` — spawn a real pty for
  that shell type via node-pty; return a stable session id.
- `write(sessionId, data: string)` — forward raw keystrokes/bytes to the pty.
- `resize(sessionId, cols, rows)` — propagate terminal size (xterm fit addon).
- `kill(sessionId)` — terminate the pty.
- `onData(sessionId, cb: (data: string) => void)` — subscribe to the pty's
  output stream. Implemented over a `contextBridge`-exposed
  `ipcRenderer.on('shell:data', ...)` channel, since data flows main→renderer
  continuously (the current preload only does `invoke`, which is
  request/response — M2 adds an event channel).
- `prompt(shell)` — **removed.** Prompts now come from the real shell's own
  output; Redcell no longer fabricates them.

`ShellRunResult`/`ShellLine` line-model types are removed from the renderer
path (they belong to the mock). `ShellTab`/`ShellId` stay.

### Shell resolution per platform

- `pwsh` → `powershell.exe` (Windows) / `pwsh` if present. On macOS, the
  "PowerShell" tab is only shown if `pwsh` is installed; otherwise omitted.
- `cmd` → `cmd.exe` (Windows only; omitted on macOS).
- `kali` → `wsl.exe -d kali-linux` (Windows). On macOS there is no WSL — show
  the platform login shell (`$SHELL`, typically `/bin/zsh`) under a "shell"
  tab instead. Tab set is therefore platform-dependent; `tabs()` computes it
  at runtime from what's installed.
- Unavailable shells are omitted from `tabs()` rather than shown broken.

### Buffer persistence across dock close/reopen

The M1 handover flagged: terminal buffers reset when the dock closes because
session state lived in the `TerminalDock` component. With real ptys the process
keeps running whether or not the dock is visible, so:

- PTY sessions live in the **main process**, keyed by `sessionId`, independent
  of dock visibility. Closing the dock (`closeTerminal`) hides the UI but does
  **not** kill the pty.
- The main process keeps a bounded **scrollback buffer** per session (ring
  buffer, cap e.g. 10k lines / a few MB) so a reopened dock can replay recent
  output into a fresh xterm instance via `onData` replay or a
  `getScrollback(sessionId)` call.
- Reopening the dock re-attaches xterm to the existing session and repaints
  scrollback — the running `nmap` you left is still running.

### Session lifecycle

- One pty session per shell tab, created lazily on first view of that tab.
- Killed when: the app quits (kill all on `before-quit`), or explicitly by the
  user. (Chats do not own terminal sessions — the dock is shared across the
  operator per the M1 model — so "kill on chat close" from the roadmap reduces
  to "kill on app close" plus explicit kill; noted to avoid over-building.)
- Guard against orphaned ptys: track all sessions in a registry and reap on
  quit; on Windows ensure the WSL/child tree is terminated, not just the
  parent.

### Renderer changes (TerminalDock.tsx)

- Swap the `<pre>`-per-line renderer + `<input>` for an `xterm.js` `Terminal`
  mounted in `termRef`, with `FitAddon`.
- `term.onData(d => window.redcell.shell.write(sessionId, d))` sends keystrokes.
- `window.redcell.shell.onData(sessionId, d => term.write(d))` renders output.
- On mount/resize: `fitAddon.fit()` then `shell.resize(sessionId, cols, rows)`.
- Keep the existing dock chrome verbatim: resize handle, tab bar, "Shared with
  agent" pill, close button, colors/hex from `theme.ts` — only the scroll area
  internals change. Preserve exact styling per the CLAUDE.md fidelity rule.
- Switching tabs attaches/detaches xterm to the corresponding session
  (or lazily creates it).

### Native dependency handling (the real risk)

- `node-pty` is a native module and must be rebuilt against Electron's Node ABI
  (`electron-rebuild` / `@electron/rebuild`), not the system Node used for
  tests. Wire this into `postinstall` and the build.
- Verify prebuilt binaries exist (or build) for all target arches: macOS
  arm64 + x64, Windows x64.
- This is the first thing to prove in M2 — a "spawn a pty, echo a command,
  read output back" spike before any UI work, to catch ABI/rebuild issues
  early.

### Testing

- Unit: shell resolution logic (which tabs exist on which platform, given a
  faked "installed" probe) — pure, no pty.
- Unit: scrollback ring buffer (cap enforcement, replay ordering).
- Integration (main process, real node-pty): create a session, write
  `echo hello\n` (or `whoami`), assert the streamed output contains the
  expected text; resize; kill; assert the process is gone. Gated to run where a
  shell exists (both CI OSes qualify).
- The xterm renderer itself is hard to unit-test meaningfully; cover it via the
  M2 dogfood/manual check on both OSes rather than brittle DOM assertions.
- CI (from M0) runs the pure + main-process tests on macOS and Windows.

### M2 acceptance

- On macOS: dock opens a real zsh (and pwsh if installed); `ls`, `top`, `sudo`
  (password prompt renders), Ctrl-C all behave like a real terminal.
- On Windows: real PowerShell and cmd; WSL-Kali tab runs an actual Kali shell;
  an interactive program (e.g. `less`) renders correctly.
- Start a long-running command, close the dock, reopen it — the command is
  still running and scrollback repaints.
- Quit the app — no orphaned pty/WSL processes remain.
- All M1 tests still pass; new shell tests pass on both CI OSes.

### M2 explicitly NOT in scope

- The agent driving the shell (that is M3 — M2 is the operator's manual
  terminal only; the "Shared with agent" pill stays visual until M3).
- Persisting scrollback to disk across full app restarts (in-memory only;
  disk persistence is M4's concern if we decide terminals need it — likely we
  do not).
- Per-command approval UI (execution is ungated by decision).
