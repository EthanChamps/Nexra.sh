# Redcell — Milestone 1 (UI Shell) Design

**Date:** 2026-07-01
**Status:** Approved (design), pending implementation plan
**Scope:** Milestone 1 of a multi-milestone build

## 1. Product summary

Redcell is a cross-platform (macOS + Windows) desktop application for security
consultants. It is an AI-agent console for running security engagements. The
information hierarchy is:

- **Project** — a client / company (e.g. "Acme Corp").
- **Engagement** — one review of a fixed *type* against that client. Each type
  has fixed phases, a curated toolset, and a scope block. Five types:
  - AWS Config Review — phases: IAM, Storage (S3), Network (VPC), Logging &
    Monitoring. Tools: prowler, scoutsuite, aws-cli, pmapper.
  - Azure Config Review — Entra ID, Storage, Network, Logging. Tools:
    scoutsuite, az-cli, roadrecon, pingcastle.
  - M365 Config Review — Identity, Exchange, SharePoint, Compliance. Tools:
    scoutsuite, msol, purview, maester.
  - Internal Pen Test — linear: Recon → Exploit. Tools: nmap, bloodhound,
    crackmapexec, impacket.
  - External Pen Test — linear: Recon → Exploit. Tools: nmap, nuclei, amass,
    burp.
- **Chat** — a focused agent thread scoped to one phase, with its own context
  window, its own message history, its own findings, and its own tool
  availability. Chats have a background colour and can be renamed/deleted.

Each chat is an AI agent conversation that: streams assistant text, runs tools
(shown as tool-call cards: running / success-with-output / not-installed with an
Install action), logs findings to a right-hand context panel, and shares a
bottom **terminal dock** (PowerShell / cmd / Kali-WSL) with the operator.

The authoritative visual + behavioural reference is the imported Claude Design
prototype `Redcell.dc.html` (project `3894fbba-...`). Its embedded
`DCLogic` component class defines the exact data model, demo content, terminal
command simulation, and interaction logic that this milestone reproduces.

## 2. Milestone 1 goal

A **pixel-faithful, runnable Electron app** reproducing the entire prototype —
every screen, modal, context menu, the terminal dock with *simulated* shells,
the Scope/Findings/Tools panels, and the demo data — architected so that the
real backends (ungated command execution, the Claude-first provider-agnostic
agent, and SQLite persistence) drop in later behind clean service interfaces
**without UI rework**.

M1 is a real app with mock backends, not a throwaway prototype: the mocks
implement the same interfaces the real services will.

## 3. Decisions locked (with the user)

- **Framework:** Electron with a React + Vite renderer. Chosen because the app's
  core job is spawning fully-interactive shells (PowerShell, cmd, WSL, bash) —
  best served by Node's `node-pty` + `xterm.js` (VS Code's stack) — and because
  "work for all AI" is easiest via a provider-agnostic Node layer.
- **AI layer:** provider-agnostic via the Vercel AI SDK (v6). Claude (Anthropic)
  is wired live in a later milestone; OpenAI / Google / Ollama are selectable in
  Settings and trivially addable. Architecture is agnostic from day one.
- **Eventual execution model:** real execution with **no per-command approval
  gate** (agent runs commands autonomously; an allowlist can be added later).
  This is the *target*; M1 ships simulated execution only.
- **This milestone's scope:** **UI shell only** — no real execution, no live LLM
  calls, no disk persistence.

## 4. Architecture

Electron three-process shape.

### Main process (Node)
Hosts three service interfaces. In M1 each is **mock-backed**; the interface is
what the renderer sees, so swapping mock→real is invisible upstream.

- `StoreService` — CRUD over projects / engagements / chats / findings /
  messages. **M1:** in-memory, seeded from the ported demo data. **Later:**
  `better-sqlite3` on disk.
- `AgentService` — takes a user message for a chat and returns a **stream of
  events**: `{type:'text', ...}`, `{type:'tool_call', state:'running'|'success'
  |'unavailable', ...}`, `{type:'finding', ...}`, `{type:'done'}`. **M1:** the
  scripted mock ported from the prototype's `send()` / `install()` timing logic.
  **Later:** Vercel AI SDK agent loop over the chat's tools, Claude default.
- `ShellService` — PTY session lifecycle: create/write/resize/kill, emits
  `data` events per session. **M1:** canned output ported from the prototype's
  `terminalOutput()` (help/whoami/pwd/ls/dir/ipconfig/ifconfig/nmap/nikto/
  clear + realistic "not recognized" fallbacks per shell). **Later:**
  `node-pty` spawning real PowerShell / cmd / WSL / bash.

### Preload
`contextBridge` exposes a typed, minimal API:
`window.redcell.store.*` (promise-returning CRUD),
`window.redcell.agent.send(chatId, text)` + event subscription,
`window.redcell.shell.*` (create/write/resize/kill) + `data` subscription.
No Node globals leak to the renderer; `contextIsolation` on, `nodeIntegration`
off.

### Renderer (React + Vite)
The UI, ported faithfully from the `.dc` markup. The prototype's `Component`
class becomes a React **state container** (`useReducer` mirroring the class's
`state` + methods). All data is read/written through `window.redcell.*` — never
directly — so the mock/real boundary is respected. Styling reproduces the
prototype 1:1 (exact hex palette, IBM Plex Sans/Mono, spacing) using
co-located inline styles / a small `theme.ts`, matching the source so
divergence is easy to spot; token extraction is a later cleanup.

## 5. Screens & components (ported verbatim)

1. **Home / Projects** — grid of company cards (name, engagement-count/updated,
   status-coloured type chips), New Project card + button.
2. **Workspace**
   - **Sidebar** — back-to-projects, company header + monogram, New Engagement,
     engagement list with status dots + active highlight, nested chat list per
     active engagement (colour dot, name, focus label, active state), New chat
     affordance, empty states.
   - **Chat pane** — three states: no-engagement, engagement-with-no-chats, and
     active chat. Active chat: header (inline rename input ↔ name + rename
     button + focus badge + breadcrumb), scrolling message list (assistant text,
     user bubble, tool-running spinner card, tool-success card with mono output
     + duration, tool-unavailable card with Install/Learn-more + install cmd),
     composer (attach, terminal toggle, send; Enter-to-send).
3. **Right context panel** — Scope table, Findings list (severity-coloured,
   phase + time; empty state), Chat Tools list (available/missing). Collapsed
   vertical rail when hidden. Only shown when a chat is active.
4. **Terminal dock** — fixed bottom, drag-to-resize handle, 3 shell tabs
   (PowerShell / Command Prompt / Kali·WSL) each with its own session buffer,
   "Shared with agent" badge, close button, command input with simulated output,
   Ctrl+` global toggle. Per-shell prompts and command responses ported exactly.
5. **Modals** — New Project (company name), New Engagement (radio list of 5
   review types + optional display name), New Chat (focus chips from the
   engagement's phases + optional name + 6-colour background picker). Chat
   right-click **context menu** (rename / colour grid / delete).
6. **Settings (new, minimal)** — provider + model picker (Claude default) and
   per-provider API-key fields. Persisted in the store but inert in M1. Small
   addition so "others ready" is genuinely wired.

**Demo data** ports `buildTypes`, `buildInitial`, `enrichAws`,
`enrichInternal`, and `buildTerminalSessions` verbatim: 3 companies (Acme /
Contoso / Globex), 5 engagements across them (one deliberately empty to show the
no-chats state), richly-seeded IAM + Recon + Exploit chats with real-looking
tool output and findings.

## 6. Behaviours reproduced (from the prototype logic)

- Navigation: open company → workspace, select engagement → default/active
  chat, select chat, back to home.
- New project → new empty workspace; new engagement (prepended); new chat
  (prepended, becomes active, seeded assistant greeting).
- Rename chat (header pencil / inline / Enter-Escape / context menu), set chat
  colour (context menu + new-chat picker), delete chat (with active-chat
  reassignment).
- Send message → scripted assistant reply + running tool card → success card →
  follow-up text (mock timings preserved).
- Install action on an unavailable tool → running → success → tool marked
  available + confirmation message.
- Terminal: switch shells, run simulated commands, clear, resize, focus, Ctrl+`.
- Context panel toggle + collapsed rail.

## 7. Explicitly deferred (behind the mocks)

Real command execution (ungated), live LLM/agent calls, disk persistence, real
tool detection & install, real findings extraction, and building signed
installers. `electron-builder` config is scaffolded (mac dmg arm64+x64, Windows
nsis) but M1's runnable target is `npm run dev` on both OSes.

## 8. Testing

Scaled to a UI port: Vitest + React Testing Library smoke/behaviour tests for
the reducer (navigation, create/rename/delete, send flow) and the two highest-
risk components (tool-call card variants, terminal command simulation). Manual
visual diff against the prototype. Not heavy TDD.

## 9. Project structure

```
redcell/
  package.json
  vite.config.ts
  electron-builder.yml
  tsconfig.json
  electron/
    main.ts              # window lifecycle + service wiring + IPC handlers
    preload.ts           # contextBridge → window.redcell
    services/
      store.types.ts  store.mock.ts
      agent.types.ts  agent.mock.ts
      shell.types.ts  shell.mock.ts
  src/                   # renderer
    main.tsx  App.tsx
    theme.ts
    state/               # reducer + types mirroring the .dc Component
    ipc.ts               # thin typed wrapper over window.redcell
    data/                # ported demo seed
    screens/             # Home, Workspace
    components/          # Sidebar, ChatPane, MessageList, ToolCard,
                         #   ContextPanel, TerminalDock, modals, ContextMenu,
                         #   Settings
  test/
```

## 10. Success criteria for M1

- `npm run dev` launches the Electron app on macOS and Windows.
- Every screen, modal, context menu, and the terminal dock from the prototype
  is present and matches it visually.
- All prototype interactions work against the mock services.
- No component imports a mock service directly; everything goes through
  `window.redcell.*`, so later milestones swap backends without UI edits.
