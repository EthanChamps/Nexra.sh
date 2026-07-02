# Nexra.sh

A cross-platform (macOS + Windows) Electron desktop console for AI security engagements. This is the **M1 UI shell** — a fully functional UI prototype with mock backends, no real command execution, no live LLM integration, and no disk persistence.

## Prerequisites

- **Node 20+**

## Quick Start

```bash
npm install
npm run dev      # Launch Electron app in dev mode (requires display/GUI)
npm test         # Run Vitest suite (20 tests)
npm run build    # TypeScript typecheck + Vite build
npm run dist     # Build production installers (macOS dmg + Windows nsis)
```

## Architecture

Nexra.sh separates the UI from backend services via an **IPC boundary** — all React components communicate with Electron services through a `contextBridge` preload that exposes `window.nexra.*`. This design ensures real backends can be dropped in without UI changes.

### Three Mock Services

All services live in `electron/services/` and are currently mocked:

1. **StoreService** (`store.mock.ts`)
   - In-memory seed data: companies, engagements, chats, findings
   - Future: `better-sqlite3` for persistent local storage

2. **AgentService** (`agent.mock.ts`)
   - Scripted, streaming responses to user commands (`runSend`, `runInstall`)
   - Simulates AI analysis and tool installation workflows
   - Future: Vercel AI SDK + Claude for real agent execution

3. **ShellService** (`shell.mock.ts`)
   - Canned shell output for demo commands (whoami, nmap, nikto, etc.)
   - Multi-shell support: bash (Kali), cmd, PowerShell
   - Future: `node-pty` for real terminal spawning (PowerShell, cmd, WSL, bash)

### Service Interface Boundary

React components **never import services directly**. All access goes through `window.nexra.*`:

```typescript
// Preload (electron/preload.ts) exposes services via contextBridge:
window.nexra.store.snapshot()
window.nexra.agent.send(request, onEvent)
window.nexra.agent.install(request, onEvent)
window.nexra.shell.tabs()
window.nexra.shell.run(shellId, command)
window.nexra.shell.prompt(shellId)
```

Main process (`electron/main.ts`) wires up IPC handlers to invoke the mock services and stream responses back to the renderer.

## What's Included

- ✓ **Full UI shell:** Home, Workspace/Sidebar, ChatPane, Context panel, Terminal dock, Settings, Modals
- ✓ **State management:** Redux-like reducer + selectors
- ✓ **Test coverage:** 20 Vitest tests across components, services, and reducer
- ✓ **Design fidelity:** Styled per `design-reference/Nexra.dc.html` (vendored prototype)
- ✓ **Multi-OS:** Electron builder scaffolded for macOS (dmg, arm64 + x64) and Windows (nsis)

## M1 Non-Goals

The following are explicitly out of scope for this milestone:

- ❌ Real command execution (shell commands execute locally, not mocked)
- ❌ Live LLM/AI integration (agent responses are scripted)
- ❌ Disk persistence beyond the session (in-memory only)
- ❌ Real tool detection or installation
- ❌ Findings extraction or reporting
- ❌ Signed/notarized installers

These features will be added when their respective backends are integrated.

## Native modules (better-sqlite3)

`better-sqlite3` is a native module compiled against V8 headers, so its binary
is ABI-specific (plain Node vs. Electron have different ABIs). We keep the
plain-Node ABI as the install-time default and rebuild for Electron
just-in-time at launch:

- A fresh `npm install` leaves `better-sqlite3` at the **plain-Node ABI**, so
  `npm test` (which runs under Vitest's Node, not Electron) works out of the box.
- `npm run dev` and `npm run dist` run a `predev` / `predist` hook that rebuilds
  `better-sqlite3` for **Electron's ABI** just-in-time, right before the app
  runs or packages.
- If you run `npm test` immediately after `npm run dev` (binary now at the
  Electron ABI), run `npm rebuild better-sqlite3` first to flip it back to the
  Node ABI.

(`node-pty` ships an N-API prebuild, so it is ABI-stable across Node/Electron
and needs no rebuild.)

## Development Notes

- **Dev mode** (`npm run dev`) runs Vite dev server and Electron in watch mode — requires a display/GUI
- **Testing** uses Vitest with React Testing Library; run `npm test` or `npm run test:watch`
- **Build output:** `dist/` (web bundle) + `dist-electron/` (preload + main compiled JS)
- **Type safety:** Full TypeScript coverage; `npm run build` includes `tsc` typecheck
