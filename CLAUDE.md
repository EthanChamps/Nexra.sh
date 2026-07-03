# Nexra.sh

Cross-platform (macOS + Windows) Electron desktop app: an AI-agent console
for security consultants. Hierarchy: Project (client) → Engagement (5 fixed
review types: AWS/Azure/M365 config review, Internal/External pen test) →
Chat (focused agent thread per phase, own context/findings/tools). Full
context: `docs/superpowers/HANDOVER.md`.

## Status

**M1–M3 complete; M4 (persistence) in progress.** Electron + React/Vite app
in `nexra/`. `ShellService` runs real `node-pty` sessions (xterm.js renderer);
`AgentService` is a live Vercel AI SDK v6 + Claude agent (ungated tool-calling,
findings, agent-requested inputs). `StoreService` is still a mock for
projects/engagements/chats/messages — M4 replaces it with `better-sqlite3`
(`store.sqlite.ts`); settings and findings already persist to sqlite (landed
during M3). Run `npm test` for the current suite.

```bash
cd nexra && npm install && npm run dev   # launch (needs a display)
npm test                                    # unit + integration suite
npm run build                               # tsc + vite build
```

## Architecture (locked decisions)

- Electron (not Tauri) — needs real interactive PTYs (PowerShell/cmd/WSL) via
  `node-pty`, and provider-agnostic AI via Node.
- AI: provider-agnostic via Vercel AI SDK v6 (live since M3), Claude default.
- Target execution model: **real, ungated** (no per-command approval). M2
  delivered this for the operator's own terminal (`node-pty`, no gate); M3
  delivered the autonomous agent driving the shell with ungated tool-calls.
- Service boundary: `electron/services/store.mock.ts` (being replaced by
  `store.sqlite.ts` in M4) + `agent.live.ts` + `shell.pty.ts` (real), exposed
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

## Remaining (M4–M6)

- **M4 (in progress):** `better-sqlite3` in `StoreService` — projects/
  engagements/chats/messages/findings survive restart; schema-migration test.
- **M5:** cross-platform (verified Windows run incl. WSL-Kali) + packaging;
  bump `electron-builder` to `^26`; signed + notarized macOS/Windows installers.
  Must follow M4 — package once functionally complete. Kick off Apple cert
  procurement *during* M4 (notarization has calendar latency).
- **M6:** pre-ship hardening — `/security-review`, OS-keychain API-key storage,
  prompt-injection review, crash handling, dogfood pass. Overlaps M5.

Roadmap: `docs/superpowers/specs/2026-07-01-redcell-shipping-roadmap.md`. Full
context: `docs/superpowers/HANDOVER.md`.

## Process

Built via `superpowers:brainstorming` → spec → `writing-plans` → plan (14
tasks for M1, 8 for M2) → `subagent-driven-development` (implementer +
reviewer subagent per task, fix loops on findings, final whole-branch
review) → `finishing-a-development-branch`. Follow the same process for M4.
