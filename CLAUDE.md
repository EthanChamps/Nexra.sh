# Nexra.sh

Cross-platform (macOS + Windows) Electron desktop app: an AI-agent console
for security consultants. Hierarchy: Project (client) → Engagement (5 fixed
review types: AWS/Azure/M365 config review, Internal/External pen test) →
Chat (focused agent thread per phase, own context/findings/tools). Full
context: `docs/superpowers/HANDOVER.md`.

## Status

**M1 (UI shell) complete** and merged to `master`. Electron + React/Vite app
in `nexra/`, mock backends only (no real execution, no live LLM, no
persistence). 20/20 tests passing.

```bash
cd nexra && npm install && npm run dev   # launch (needs a display)
npm test                                    # 20 tests
npm run build                               # tsc + vite build
```

## Architecture (locked decisions)

- Electron (not Tauri) — needs real interactive PTYs (PowerShell/cmd/WSL) via
  `node-pty`, and provider-agnostic AI via Node.
- AI: provider-agnostic via Vercel AI SDK v6 (planned), Claude default.
- Target execution model: **real, ungated** (no per-command approval) — not
  yet implemented, M1 is UI-only.
- Service boundary: `electron/services/{store,agent,shell}.mock.ts`, exposed
  via `contextBridge` as `window.nexra.*`. **No renderer component may
  import a service directly** — always go through `window.nexra.*` so real
  backends swap in without UI changes.
- Styling source of truth: vendored prototype at
  `nexra/design-reference/Nexra.dc.html` — match hex/px exactly when
  porting any UI; do not snap rgba alphas to the nearest `theme.ts` token if
  it doesn't match exactly (recurring bug source in M1). This does not mean
  porting every decorative glyph — see icon usage below.
- Icon usage: icons are for actions and status, not decoration. Don't add a
  glyph/icon to a component just because the design reference has one there
  — port it only if it conveys meaning (an action, a state, a type). Default
  to none; when unsure, leave it out and ask rather than filling empty space
  with a symbol.

## Deferred to M2

Real node-pty execution, live Claude/AI-SDK agent, sqlite persistence,
terminal-buffer persistence across dock close/reopen, overlapping-stream
guard, bump `electron-builder` before building signed installers. Full list
with reasoning in `docs/superpowers/HANDOVER.md`.

## Process

Built via `superpowers:brainstorming` → spec → `writing-plans` → plan (14
tasks) → `subagent-driven-development` (implementer + reviewer subagent per
task, fix loops on findings, final whole-branch review) →
`finishing-a-development-branch`. Follow the same process for M2.
