# Redcell M1 (UI Shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a pixel-faithful, runnable Electron desktop app that reproduces the entire Redcell prototype (all screens, modals, terminal dock, demo data) with mock backends behind service interfaces the real backends will later implement.

**Architecture:** Electron main process hosts three mock-backed services (`StoreService`, `AgentService`, `ShellService`) exposed to a React+Vite renderer via a `contextBridge` preload (`window.redcell`). The renderer ports the prototype's `DCLogic` class into a `useReducer` state container and its markup into React components. No component touches a service directly — everything flows through `window.redcell.*`, so mock→real is a later swap with no UI edits.

**Tech Stack:** Electron, TypeScript, Vite, React 18, `vite-plugin-electron`, Vitest + React Testing Library, electron-builder. (node-pty, better-sqlite3, Vercel AI SDK are *later* milestones — do not add them here.)

## Global Constraints

- Platforms: macOS (arm64 + x64) and Windows (nsis). M1 runnable target is `npm run dev` on both; installers scaffolded, not built.
- Fonts: `IBM Plex Sans` (weights 400/500/600) and `IBM Plex Mono` (400/500), loaded from Google Fonts exactly as the prototype's `<helmet>` does.
- Palette (verbatim from prototype): app bg `#0a0b0d`; panels `#0c0d10` / `#0d0e11` / `#101216` / `#111318`; inputs/cards `#15171c`; terminal bg `#070809`; primary text `#e7e9ec`; muted `#8b929c` / `#9096a0`; dim `#656b74` / `#565c65`; accent indigo `#6f7bf0` (hover `#5866f0`), accent-soft `#9aa2f5` / `#aab0f7`; severity `Critical #f0616d`, `High #f0954a`, `Medium #e6b23f`, `Low #7c828b`; success `#46c47f` / `#5bd493`; warning `#e6a23c`. Use these exact hex values.
- Electron security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false` (preload needs Node), renderer never gets Node globals.
- No real command execution, no live LLM calls, no disk persistence in M1. Mocks only.
- Source of visual + behavioural truth: `design-reference/Redcell.dc.html` (vendored in Task 1). When a task says "port section X", convert `sc-if value="{{c}}"`→`{c && (...)}`, `sc-for list="{{xs}}" as="x"`→`xs.map(x => ...)`, `{{ expr }}`→`{expr}`, `style="..."`→`style={{...}}`, `onClick="{{ fn }}"`→`onClick={fn}`, `style-hover="..."`→a hover handler or CSS `:hover` via a shared style helper. Keep every hex/px value identical.

---

## File Structure

```
redcell/
  package.json                     # scripts, deps
  tsconfig.json  tsconfig.node.json
  vite.config.ts                   # react + vite-plugin-electron
  electron-builder.yml             # mac dmg + win nsis (scaffold)
  index.html                       # Vite entry, loads fonts
  design-reference/Redcell.dc.html # vendored prototype (styling truth)
  electron/
    main.ts                        # window + IPC handler registration
    preload.ts                     # contextBridge → window.redcell
    services/
      store.types.ts  store.mock.ts
      agent.types.ts  agent.mock.ts
      shell.types.ts  shell.mock.ts
      seed.ts                      # ported demo data
  src/
    main.tsx  App.tsx
    global.d.ts                    # window.redcell typing
    theme.ts                       # palette + font constants + style helpers
    ipc.ts                         # typed wrapper over window.redcell
    state/
      types.ts                     # domain + UI state types
      reducer.ts                   # ported DCLogic logic
      selectors.ts                 # activeCompany/Engagement/Chat, renderVals
    screens/
      Home.tsx
      Workspace.tsx
    components/
      Sidebar.tsx
      ChatPane.tsx
      MessageList.tsx
      ToolCard.tsx
      Composer.tsx
      ContextPanel.tsx
      TerminalDock.tsx
      ContextMenu.tsx
      modals/NewProjectModal.tsx  NewEngagementModal.tsx  NewChatModal.tsx
      Settings.tsx
      Hoverable.tsx                # style-hover helper
  test/
    reducer.test.ts
    agent.mock.test.ts
    shell.mock.test.ts
    ToolCard.test.tsx
    TerminalDock.test.tsx
```

---

### Task 1: Project scaffold + blank Electron window + vendored reference

**Files:**
- Create: `redcell/package.json`, `redcell/tsconfig.json`, `redcell/tsconfig.node.json`, `redcell/vite.config.ts`, `redcell/index.html`, `redcell/electron/main.ts`, `redcell/electron/preload.ts`, `redcell/src/main.tsx`, `redcell/src/App.tsx`, `redcell/electron-builder.yml`, `redcell/design-reference/Redcell.dc.html`

**Interfaces:**
- Produces: a working `npm run dev` that opens an Electron window rendering React; the preload exposes an empty `window.redcell = {}` placeholder (filled in Task 3).

- [ ] **Step 1: Vendor the reference prototype**

Save the full `Redcell.dc.html` contents (from the imported Claude Design project `3894fbba-5f50-4469-a73a-6c9f110f36d7`, file `Redcell.dc.html`) to `redcell/design-reference/Redcell.dc.html`. This is the styling/behaviour source of truth referenced by later tasks. (If the design MCP is unavailable to the implementer, the orchestrator provides the file.)

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "redcell",
  "version": "0.1.0",
  "description": "Redcell — AI security engagement console",
  "main": "dist-electron/main.js",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.node.json && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "dist": "npm run build && electron-builder"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^16.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "electron": "^31.0.0",
    "electron-builder": "^24.13.0",
    "jsdom": "^24.1.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vite-plugin-electron": "^0.28.0",
    "vite-plugin-electron-renderer": "^0.14.0",
    "vitest": "^2.0.0"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json` and `tsconfig.node.json`**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2021", "useDefineForClassFields": true, "lib": ["ES2021", "DOM", "DOM.Iterable"],
    "module": "ESNext", "skipLibCheck": true, "moduleResolution": "Bundler",
    "resolveJsonModule": true, "isolatedModules": true, "noEmit": true,
    "jsx": "react-jsx", "strict": true, "noUnusedLocals": true, "noUnusedParameters": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "electron", "test"]
}
```

`tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "target": "ES2021", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "skipLibCheck": true, "outDir": "dist-electron"
  },
  "include": ["electron"]
}
```

- [ ] **Step 4: Write `vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

export default defineConfig({
  plugins: [
    react(),
    electron([
      { entry: 'electron/main.ts' },
      { entry: 'electron/preload.ts', onstart(o) { o.reload() } },
    ]),
    renderer(),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './test/setup.ts',
  },
})
```

- [ ] **Step 5: Write `index.html`, `src/main.tsx`, `src/App.tsx`**

`index.html`:
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Redcell</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    *{box-sizing:border-box} html,body,#root{margin:0;padding:0;height:100%}
    body{background:#0a0b0d;color:#e7e9ec;font-family:'IBM Plex Sans',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
    ::-webkit-scrollbar{width:10px;height:10px}
    ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.08);border-radius:8px;border:2px solid transparent;background-clip:content-box}
    ::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.16);background-clip:content-box}
    input::placeholder{color:#565c65}
    @keyframes spin{to{transform:rotate(360deg)}}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

`src/main.tsx`:
```tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
```

`src/App.tsx` (temporary until Task 6):
```tsx
export default function App() {
  return <div style={{ padding: 40, color: '#e7e9ec' }}>Redcell — booting…</div>
}
```

- [ ] **Step 6: Write `electron/main.ts` and `electron/preload.ts`**

`electron/main.ts`:
```ts
import { app, BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname2 = path.dirname(fileURLToPath(import.meta.url))

function createWindow() {
  const win = new BrowserWindow({
    width: 1360, height: 900, minWidth: 1080, minHeight: 680,
    backgroundColor: '#0a0b0d', show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname2, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  })
  win.once('ready-to-show', () => win.show())
  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL)
  else win.loadFile(path.join(__dirname2, '../dist/index.html'))
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
```

`electron/preload.ts`:
```ts
import { contextBridge } from 'electron'
// Filled out in Task 3. Placeholder keeps window.redcell defined.
contextBridge.exposeInMainWorld('redcell', {})
```

- [ ] **Step 7: Write `electron-builder.yml` (scaffold)**

```yaml
appId: com.redcell.app
productName: Redcell
directories: { output: release }
files: [ "dist/**/*", "dist-electron/**/*" ]
mac: { target: [ { target: dmg, arch: [arm64, x64] } ], category: public.app-category.developer-tools }
win: { target: [ nsis ] }
```

- [ ] **Step 8: Install and run**

Run: `cd redcell && npm install && npm run dev`
Expected: an Electron window opens showing "Redcell — booting…" on the dark background, IBM Plex font applied.

- [ ] **Step 9: Add `test/setup.ts` and commit**

`test/setup.ts`:
```ts
import '@testing-library/jest-dom'
```

```bash
git add redcell
git commit -m "feat: scaffold Electron+Vite+React app with blank window"
```

---

### Task 2: Domain types + service type contracts

**Files:**
- Create: `redcell/electron/services/store.types.ts`, `agent.types.ts`, `shell.types.ts`, `redcell/src/state/types.ts`, `redcell/src/global.d.ts`

**Interfaces:**
- Produces: all shared types. Later tasks import these exact names.

- [ ] **Step 1: Write `electron/services/store.types.ts`**

```ts
export type ReviewTypeId = 'aws' | 'azure' | 'm365' | 'internal' | 'external'
export type Severity = 'Critical' | 'High' | 'Medium' | 'Low'
export type EngagementStatus = 'In Progress' | 'Complete'

export interface Phase { id: string; label: string }
export interface ToolAvailability { name: string; available: boolean }
export interface ScopeRow { label: string; value: string }

export interface ReviewTypeConfig {
  label: string; short: string; linear: boolean
  phases: Phase[]; tools: ToolAvailability[]; scope: ScopeRow[]
}

export type MessageRole = 'user' | 'assistant'
export type MessageKind = 'text' | 'tool'
export type ToolState = 'running' | 'success' | 'unavailable'

export interface Message {
  id: string; role: MessageRole; kind: MessageKind
  content?: string
  toolName?: string; command?: string; output?: string; duration?: string
  reason?: string; installCmd?: string; state?: ToolState
}

export interface Finding { title: string; sev: Severity; phase: string; time: string }

export interface Chat {
  id: string; name: string; phaseId: string; color: string
  messages: Message[]; findings: Finding[]; tools: ToolAvailability[]
}

export interface Engagement {
  id: string; type: ReviewTypeId; name: string; status: EngagementStatus
  updated: string; linear: boolean; phases: Phase[]; scope: ScopeRow[]; chats: Chat[]
}

export interface Company { id: string; name: string; updated: string; engagements: Engagement[] }

export interface Snapshot { companies: Company[]; types: Record<ReviewTypeId, ReviewTypeConfig> }
```

- [ ] **Step 2: Write `electron/services/agent.types.ts`**

```ts
import type { Severity, ToolState } from './store.types'

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; state: ToolState; toolName: string; command?: string; output?: string; duration?: string; reason?: string; installCmd?: string }
  | { type: 'finding'; title: string; sev: Severity; phase: string; time: string }
  | { type: 'done' }

export interface AgentSendRequest { chatId: string; engagementType: string; phaseLabel: string; primaryTool: string; text: string }
export interface AgentInstallRequest { chatId: string; toolName: string; installCmd?: string }
```

- [ ] **Step 3: Write `electron/services/shell.types.ts`**

```ts
export type ShellId = 'pwsh' | 'cmd' | 'kali'
export interface ShellTab { id: ShellId; label: string; color: string }
export interface ShellLine { kind: 'cmd' | 'out' | 'sys'; text: string; prompt?: string; promptColor?: string }
export interface ShellRunResult { lines: ShellLine[]; clear?: boolean }
```

- [ ] **Step 4: Write `src/state/types.ts`**

```ts
export interface CtxMenuState { open: boolean; x: number; y: number; engId: string | null; chatId: string | null }

export interface UIState {
  view: 'home' | 'workspace'
  activeCompanyId: string | null
  activeEngagementId: string | null
  activeChatByEngagement: Record<string, string>
  draft: string
  rightOpen: boolean
  editingName: boolean; nameDraft: string
  colorMenuOpen: boolean
  newProjectOpen: boolean; newCompanyName: string
  newOpen: boolean; selectedType: string; newName: string
  newChatOpen: boolean; newChatName: string; newChatFocus: string; newChatColor: string
  ctxMenu: CtxMenuState
  terminalOpen: boolean; terminalShell: 'pwsh' | 'cmd' | 'kali'; terminalHeight: number; terminalInput: string
  settingsOpen: boolean
}
```

- [ ] **Step 5: Write `src/global.d.ts`**

```ts
import type { Snapshot } from '../electron/services/store.types'
import type { AgentEvent, AgentSendRequest, AgentInstallRequest } from '../electron/services/agent.types'
import type { ShellId, ShellTab, ShellRunResult } from '../electron/services/shell.types'

export interface RedcellApi {
  store: { snapshot(): Promise<Snapshot> }
  agent: {
    send(req: AgentSendRequest, onEvent: (e: AgentEvent) => void): Promise<void>
    install(req: AgentInstallRequest, onEvent: (e: AgentEvent) => void): Promise<void>
  }
  shell: { tabs(): Promise<ShellTab[]>; run(shell: ShellId, raw: string): Promise<ShellRunResult>; prompt(shell: ShellId): Promise<{ stored: string; inline: string; color: string }> }
}
declare global { interface Window { redcell: RedcellApi } }
```

- [ ] **Step 6: Typecheck + commit**

Run: `cd redcell && npx tsc -p tsconfig.json --noEmit`
Expected: no errors.
```bash
git add redcell && git commit -m "feat: define domain + service type contracts"
```

---

### Task 3: Seed data + StoreService mock + IPC wiring

**Files:**
- Create: `redcell/electron/services/seed.ts`, `redcell/electron/services/store.mock.ts`
- Modify: `redcell/electron/main.ts`, `redcell/electron/preload.ts`
- Create: `redcell/src/ipc.ts`
- Test: `redcell/test/store.mock.test.ts`

**Interfaces:**
- Consumes: types from Task 2.
- Produces: `buildSnapshot(): Snapshot`; `window.redcell.store.snapshot()`; `getSnapshot()` in `ipc.ts`.

- [ ] **Step 1: Write the failing test `test/store.mock.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { buildSnapshot } from '../electron/services/store.mock'

describe('store mock seed', () => {
  it('seeds three companies', () => {
    const s = buildSnapshot()
    expect(s.companies.map(c => c.name)).toEqual(['Acme Corp', 'Contoso Ltd', 'Globex Systems'])
  })
  it('Acme has an IAM chat with a Critical finding', () => {
    const acme = buildSnapshot().companies[0]
    const aws = acme.engagements.find(e => e.type === 'aws')!
    const iam = aws.chats.find(c => c.phaseId === 'iam')!
    expect(iam.findings[0].sev).toBe('Critical')
  })
  it('one engagement is deliberately empty (no chats)', () => {
    const all = buildSnapshot().companies.flatMap(c => c.engagements)
    expect(all.some(e => e.chats.length === 0)).toBe(true)
  })
  it('exposes all five review types', () => {
    expect(Object.keys(buildSnapshot().types).sort()).toEqual(['aws','azure','external','internal','m365'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd redcell && npx vitest run test/store.mock.test.ts`
Expected: FAIL — `buildSnapshot` not found.

- [ ] **Step 3: Write `electron/services/seed.ts`**

Port the prototype's data model verbatim. Reproduce, from `design-reference/Redcell.dc.html`'s `<script type="text/x-dc">`: `buildTypes()` (all 5 types with exact phases/tools/scope), `makeEngagement`, `makeChat`, `enrichAws`, `enrichInternal`, `buildInitial` (3 companies; e3 left empty; e4/e5 get a starter chat), and `buildTerminalSessions`. Use a module-local counter for ids (replace `this._uid`). Full code:

```ts
import type { Company, Engagement, Chat, ReviewTypeId, ReviewTypeConfig, Message } from './store.types'

let _uid = 0
const uid = () => 'm' + (++_uid)

export const chatColors = [
  { id: 'slate', bg: '#0a0b0d', dot: '#3a3f47' },
  { id: 'indigo', bg: '#0d0e1c', dot: '#5866f0' },
  { id: 'teal', bg: '#08140f', dot: '#3aa980' },
  { id: 'wine', bg: '#170a0f', dot: '#d05668' },
  { id: 'amber', bg: '#16110a', dot: '#d99a4a' },
  { id: 'plum', bg: '#130a19', dot: '#a765d0' },
]

export const terminalShells = [
  { id: 'pwsh' as const, label: 'PowerShell', color: '#9aa2f5' },
  { id: 'cmd' as const, label: 'Command Prompt', color: '#c9cdd4' },
  { id: 'kali' as const, label: 'Kali · WSL', color: '#5bd493' },
]

export function buildTypes(): Record<ReviewTypeId, ReviewTypeConfig> {
  return {
    aws: { label: 'AWS Config Review', short: 'AWS', linear: false,
      phases: [{ id: 'iam', label: 'IAM' }, { id: 'storage', label: 'Storage (S3)' }, { id: 'network', label: 'Network (VPC)' }, { id: 'logging', label: 'Logging & Monitoring' }],
      tools: [{ name: 'prowler', available: true }, { name: 'scoutsuite', available: true }, { name: 'aws-cli', available: true }, { name: 'pmapper', available: false }],
      scope: [{ label: 'Account', value: '4821-9930-1174' }, { label: 'Regions', value: 'us-east-1, us-west-2' }, { label: 'Environment', value: 'Production' }, { label: 'Benchmark', value: 'CIS AWS v3.0' }] },
    azure: { label: 'Azure Config Review', short: 'AZ', linear: false,
      phases: [{ id: 'entra', label: 'Entra ID' }, { id: 'storage', label: 'Storage' }, { id: 'network', label: 'Network' }, { id: 'logging', label: 'Logging & Monitoring' }],
      tools: [{ name: 'scoutsuite', available: true }, { name: 'az-cli', available: true }, { name: 'roadrecon', available: true }, { name: 'pingcastle', available: false }],
      scope: [{ label: 'Tenant', value: 'contoso.onmicrosoft.com' }, { label: 'Subscription', value: 'prod-01' }, { label: 'Regions', value: 'eastus, westeu' }, { label: 'Benchmark', value: 'CIS Azure v2.1' }] },
    m365: { label: 'M365 Config Review', short: 'M365', linear: false,
      phases: [{ id: 'identity', label: 'Identity' }, { id: 'exchange', label: 'Exchange' }, { id: 'sharepoint', label: 'SharePoint' }, { id: 'compliance', label: 'Compliance' }],
      tools: [{ name: 'scoutsuite', available: true }, { name: 'msol', available: true }, { name: 'purview', available: true }, { name: 'maester', available: true }],
      scope: [{ label: 'Tenant', value: 'contoso.onmicrosoft.com' }, { label: 'Licenses', value: 'E5 · 1,240 seats' }, { label: 'Benchmark', value: 'CIS M365 v4.0' }] },
    internal: { label: 'Internal Pen Test', short: 'INT', linear: true,
      phases: [{ id: 'recon', label: 'Recon' }, { id: 'exploit', label: 'Exploit' }],
      tools: [{ name: 'nmap', available: true }, { name: 'bloodhound', available: true }, { name: 'crackmapexec', available: true }, { name: 'impacket', available: true }],
      scope: [{ label: 'Subnet', value: '10.10.0.0/16' }, { label: 'Domain', value: 'CORP.LOCAL' }, { label: 'DC', value: '10.10.0.5' }, { label: 'Exclusions', value: '10.10.9.0/24' }] },
    external: { label: 'External Pen Test', short: 'EXT', linear: true,
      phases: [{ id: 'recon', label: 'Recon' }, { id: 'exploit', label: 'Exploit' }],
      tools: [{ name: 'nmap', available: true }, { name: 'nuclei', available: true }, { name: 'amass', available: true }, { name: 'burp', available: false }],
      scope: [{ label: 'Domains', value: 'acme.com, *.acme.io' }, { label: 'ASN', value: 'AS40021' }, { label: 'Ranges', value: '198.51.100.0/24' }, { label: 'Rules', value: 'No DoS · business hrs' }] },
  }
}

const TYPES = buildTypes()

function makeEngagement(type: ReviewTypeId, name: string | null, status: 'In Progress' | 'Complete', updated: string): Engagement {
  const cfg = TYPES[type]
  return { id: 'e' + (++_uid), type, name: name || cfg.label, status, updated, linear: cfg.linear, phases: cfg.phases, scope: cfg.scope.map(s => ({ ...s })), chats: [] }
}

function makeChat(eng: Engagement, phaseId: string, name: string | null, color = '#0a0b0d'): Chat {
  const cfg = TYPES[eng.type]
  const ph = cfg.phases.find(p => p.id === phaseId) || cfg.phases[0]
  return {
    id: 'ch' + (++_uid), name: name || ph.label, phaseId: ph.id, color,
    messages: [{ id: uid(), role: 'assistant', kind: 'text', content: "I'm the " + ph.label + " agent for this " + cfg.label + ". Ask me to enumerate configuration, run automated checks, or log findings — this chat keeps its own context." }],
    findings: [], tools: cfg.tools.map(t => ({ ...t })),
  }
}
const stamp = (eng: Engagement) => eng.chats.forEach(c => c.messages.forEach(m => { if (!m.id) m.id = uid() }))

function enrichAws(e: Engagement) {
  const iam = makeChat(e, 'iam', 'IAM privilege review')
  iam.messages = ([
    { role: 'user', kind: 'text', content: 'Review IAM for overly permissive policies and privilege-escalation paths.' },
    { role: 'assistant', kind: 'text', content: "Starting the IAM review. I'll run Prowler's IAM checks, enumerate roles with wildcard permissions, then map privilege-escalation paths. I'll log findings to the panel as I go." },
    { role: 'assistant', kind: 'tool', toolName: 'prowler', command: 'prowler aws --service iam --status FAIL --output json', state: 'success', duration: '42.3s', output: '[iam_policy_allows_privilege_escalation]  FAIL  role/ci-deployer\n[iam_root_hardware_mfa_enabled]           FAIL  root\n[iam_user_accesskey_unused_90_days]       FAIL  12 users\n[iam_password_policy_reuse_prevention]    FAIL  account\n\n4 failed · 37 passed · 0 errors' },
    { role: 'assistant', kind: 'text', content: "Prowler flagged 4 failing controls. The critical one: role ci-deployer has an inline policy granting iam:* on * — effectively account admin reachable from the CI/CD pipeline. Pulling the policy document now." },
    { role: 'assistant', kind: 'tool', toolName: 'aws-cli', command: 'aws iam get-role-policy --role-name ci-deployer --policy-name inline-deploy', state: 'success', duration: '1.2s', output: '{\n  "Statement": [{\n    "Effect": "Allow",\n    "Action": "iam:*",\n    "Resource": "*"\n  }]\n}' },
    { role: 'assistant', kind: 'text', content: "Confirmed — unrestricted iam:* on all resources. Logged as Critical. To confirm the exploitable escalation path from the pipeline principal I'd normally map reachability with PMapper." },
    { role: 'assistant', kind: 'tool', state: 'unavailable', toolName: 'pmapper', reason: 'PMapper (AWS IAM privilege-escalation path finder) is not installed in this environment. Reachability-graph analysis for ci-deployer will be skipped until it is available.', installCmd: 'pip install principalmapper' },
    { role: 'assistant', kind: 'text', content: "I captured the direct finding from the policy document regardless. Install PMapper for the full escalation graph, or I can move on to the access-key hygiene issues." },
  ] as Message[]).map(m => ({ ...m, id: uid() }))
  iam.findings = [
    { title: 'ci-deployer role grants iam:* on *', sev: 'Critical', phase: 'IAM', time: '2m ago' },
    { title: 'Root account missing hardware MFA', sev: 'High', phase: 'IAM', time: '3m ago' },
    { title: '12 users with access keys unused >90d', sev: 'Medium', phase: 'IAM', time: '4m ago' },
    { title: 'Password policy permits reuse', sev: 'Low', phase: 'IAM', time: '4m ago' },
  ]
  const s3 = makeChat(e, 'storage', 'S3 bucket audit', '#08140f')
  s3.messages.push({ id: uid(), role: 'assistant', kind: 'tool', toolName: 'scoutsuite', command: 'scout aws --services s3 --report-dir ./scout-out', state: 'running', output: '' })
  e.chats = [iam, s3]; stamp(e)
}

function enrichInternal(e: Engagement) {
  const rc = makeChat(e, 'recon', 'Recon sweep')
  rc.messages = ([
    { role: 'user', kind: 'text', content: 'Enumerate live hosts and check SMB signing across 10.10.0.0/16.' },
    { role: 'assistant', kind: 'text', content: 'Running host discovery plus an SMB signing sweep across the in-scope subnet. This maps our initial attack surface.' },
    { role: 'assistant', kind: 'tool', toolName: 'nmap', command: 'nmap -sn 10.10.0.0/16 -oG live.txt', state: 'success', duration: '1m04s', output: 'Nmap scan: 65536 addresses, 218 hosts up\nNmap done in 64.11s' },
    { role: 'assistant', kind: 'tool', toolName: 'crackmapexec', command: 'cme smb 10.10.0.0/16 --gen-relay-list relay.txt', state: 'success', duration: '38.9s', output: 'SMB  10.10.2.14  signing:False  SMBv1:True\nSMB  10.10.2.51  signing:False\nSMB  10.10.4.03  signing:False\n... 14 hosts with signing disabled written to relay.txt' },
    { role: 'assistant', kind: 'text', content: '218 live hosts; 14 have SMB signing disabled — solid NTLM-relay candidates. Logged to findings. Spin up a separate chat when you move to exploitation so this context stays clean.' },
  ] as Message[]).map(m => ({ ...m, id: uid() }))
  rc.findings = [
    { title: 'SMB signing disabled on 14 hosts', sev: 'High', phase: 'Recon', time: '54m ago' },
    { title: 'SMBv1 enabled on legacy host', sev: 'Medium', phase: 'Recon', time: '55m ago' },
  ]
  const ex = makeChat(e, 'exploit', 'Kerberoast svc-sql', '#170a0f')
  ex.messages = ([
    { role: 'assistant', kind: 'text', content: 'Exploit agent ready. Recon handed off 14 relay candidates and 1 Kerberoastable SPN. Want me to run an NTLM relay chain or start with Kerberoasting?' },
    { role: 'user', kind: 'text', content: 'Kerberoast svc-sql first.' },
    { role: 'assistant', kind: 'tool', toolName: 'impacket', command: 'GetUserSPNs.py CORP.LOCAL/pentest -request -dc-ip 10.10.0.5', state: 'success', duration: '6.1s', output: 'ServicePrincipalName   Name     MemberOf\nMSSQL/sql01.corp.local svc-sql  Domain Admins\n\n$krb5tgs$23$*svc-sql$CORP.LOCAL$... (TGS captured)' },
    { role: 'assistant', kind: 'tool', state: 'unavailable', toolName: 'hashcat', reason: 'hashcat is not installed on this host — GPU cracking of the captured TGS ticket is unavailable locally.', installCmd: 'apt install hashcat' },
    { role: 'assistant', kind: 'text', content: "TGS captured for svc-sql (member of Domain Admins). hashcat isn't available to crack it here — install it, or I can hand the hash off to your cracking rig." },
  ] as Message[]).map(m => ({ ...m, id: uid() }))
  ex.findings = [{ title: 'Kerberoastable SPN svc-sql is Domain Admin', sev: 'High', phase: 'Exploit', time: '40m ago' }]
  ex.tools = [{ name: 'nmap', available: true }, { name: 'bloodhound', available: true }, { name: 'impacket', available: true }, { name: 'hashcat', available: false }]
  e.chats = [rc, ex]; stamp(e)
}

export function buildCompanies(): Company[] {
  _uid = 0
  const e1 = makeEngagement('aws', 'AWS Config Review', 'In Progress', '2m ago')
  const e2 = makeEngagement('internal', 'Internal Pen Test', 'In Progress', '1h ago')
  const e3 = makeEngagement('m365', 'M365 Config Review', 'Complete', '2d ago')
  const e4 = makeEngagement('azure', 'Azure Config Review', 'In Progress', '6h ago')
  const e5 = makeEngagement('external', 'External Pen Test', 'In Progress', '5d ago')
  enrichAws(e1); enrichInternal(e2)
  ;[e4, e5].forEach(e => { e.chats = [makeChat(e, e.phases[0].id, null)]; stamp(e) })
  return [
    { id: 'c1', name: 'Acme Corp', updated: '2m ago', engagements: [e1, e2] },
    { id: 'c2', name: 'Contoso Ltd', updated: '6h ago', engagements: [e3, e4] },
    { id: 'c3', name: 'Globex Systems', updated: '5d ago', engagements: [e5] },
  ]
}

export function buildTerminalSessions() {
  return {
    pwsh: [
      { kind: 'sys' as const, text: 'Windows PowerShell 7.4 · PSReadLine' },
      { kind: 'sys' as const, text: 'Shared session — the RedCell agent runs its commands in this same shell. You can take over any time. Type `help` for demo commands.' },
    ],
    cmd: [
      { kind: 'sys' as const, text: 'Microsoft Windows [Version 10.0.22631.4317]' },
      { kind: 'sys' as const, text: 'Shared session — agent + operator. Type `help` for demo commands.' },
    ],
    kali: [
      { kind: 'sys' as const, text: 'Kali GNU/Linux (WSL2) · kernel 6.6.36' },
      { kind: 'sys' as const, text: 'Shared session — agent + operator. Type `help` for demo commands.' },
    ],
  }
}
```

- [ ] **Step 4: Write `electron/services/store.mock.ts`**

```ts
import type { Snapshot } from './store.types'
import { buildCompanies, buildTypes } from './seed'

export function buildSnapshot(): Snapshot {
  return { companies: buildCompanies(), types: buildTypes() }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd redcell && npx vitest run test/store.mock.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Wire IPC in `electron/main.ts`**

Add to `main.ts` (imports + handler registration inside `app.whenReady`):
```ts
import { ipcMain } from 'electron'
import { buildSnapshot } from './services/store.mock'
// inside app.whenReady().then, before createWindow():
ipcMain.handle('store:snapshot', () => buildSnapshot())
```

- [ ] **Step 7: Expose in `electron/preload.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('redcell', {
  store: { snapshot: () => ipcRenderer.invoke('store:snapshot') },
  // agent + shell added in Tasks 11–12
})
```

- [ ] **Step 8: Write `src/ipc.ts`**

```ts
import type { Snapshot } from '../electron/services/store.types'
export const getSnapshot = (): Promise<Snapshot> => window.redcell.store.snapshot()
```

- [ ] **Step 9: Commit**

```bash
git add redcell && git commit -m "feat: seed data, store mock, and store IPC"
```

---

### Task 4: Renderer reducer + selectors (ported DCLogic logic)

**Files:**
- Create: `redcell/src/state/reducer.ts`, `redcell/src/state/selectors.ts`
- Test: `redcell/test/reducer.test.ts`

**Interfaces:**
- Consumes: `UIState` (Task 2), `Snapshot`/domain types (Task 2).
- Produces: `initialUI: UIState`; `reducer(state, action)` where `state = { data: Snapshot; ui: UIState }`; action creators are plain objects (see below); selectors `activeCompany/activeEngagement/activeChat(state)`, `monogram(name)`, `phaseLabel(eng,id)`, `colorDot(bg)`, `statusColor(st)`, `sevColor(sev)`.

The reducer ports these prototype methods (see `design-reference` `<script>`): `openCompany`, `goHome`, `selectEngagement`, `selectChat`, `toggleRight`, `createCompany`, `onNew/createProject`, `onNewChat/createChat`, rename (`startRename/saveName`), colours (`setChatColor`, `ctxSetColor`), context menu (`onChatContext/closeCtx/ctxRename/ctxDelete`), `onDraft`, and terminal state (`toggleTerminal/closeTerminal/setTerminalShell/onTerminalInput`). Mutations that add ids use a module counter `nextId(prefix)`.

- [ ] **Step 1: Write the failing test `test/reducer.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { reducer, initialUI } from '../src/state/reducer'
import { activeChat, activeEngagement } from '../src/state/selectors'
import { buildSnapshot } from '../electron/services/store.mock'

const boot = () => ({ data: buildSnapshot(), ui: initialUI })

describe('reducer', () => {
  it('opens a company into workspace with first engagement active', () => {
    const s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    expect(s.ui.view).toBe('workspace')
    expect(s.ui.activeCompanyId).toBe('c1')
    expect(activeEngagement(s)!.type).toBe('aws')
  })
  it('creates a company and lands in its empty workspace', () => {
    let s = reducer(boot(), { t: 'setNewCompanyName', value: 'Initech' })
    s = reducer(s, { t: 'createCompany' })
    expect(s.ui.view).toBe('workspace')
    expect(s.data.companies[0].name).toBe('Initech')
    expect(s.data.companies[0].engagements).toHaveLength(0)
  })
  it('creates a chat, makes it active, seeds a greeting', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    s = reducer(s, { t: 'selectEngagement', id: activeEngagement(s)!.id })
    const engId = s.ui.activeEngagementId!
    s = reducer(s, { t: 'openNewChat', engId })
    s = reducer(s, { t: 'setNewChatFocus', id: 'iam' })
    s = reducer(s, { t: 'createChat' })
    const chat = activeChat(s)!
    expect(chat.phaseId).toBe('iam')
    expect(chat.messages[0].role).toBe('assistant')
  })
  it('renames the active chat', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    s = reducer(s, { t: 'startRename' })
    s = reducer(s, { t: 'setNameDraft', value: 'Renamed' })
    s = reducer(s, { t: 'saveName' })
    expect(activeChat(s)!.name).toBe('Renamed')
  })
  it('deletes a chat and reassigns the active one', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const eng = activeEngagement(s)!
    const victim = eng.chats[0].id
    s = reducer(s, { t: 'ctxDelete', engId: eng.id, chatId: victim })
    expect(activeEngagement(s)!.chats.find(c => c.id === victim)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd redcell && npx vitest run test/reducer.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/state/selectors.ts`**

```ts
import type { Snapshot, Company, Engagement, Chat, Severity } from '../../electron/services/store.types'
import type { UIState } from './types'
export interface AppState { data: Snapshot; ui: UIState }

export const activeCompany = (s: AppState): Company | null =>
  s.data.companies.find(c => c.id === s.ui.activeCompanyId) || null
export const activeEngagement = (s: AppState): Engagement | null => {
  const c = activeCompany(s); if (!c) return null
  return c.engagements.find(e => e.id === s.ui.activeEngagementId) || null
}
export const engagementById = (s: AppState, id: string): Engagement | null => {
  const c = activeCompany(s); if (!c) return null
  return c.engagements.find(e => e.id === id) || null
}
export const activeChat = (s: AppState): Chat | null => {
  const e = activeEngagement(s); if (!e) return null
  const id = s.ui.activeChatByEngagement[e.id]
  return e.chats.find(ch => ch.id === id) || null
}
export const chatByIds = (s: AppState, engId: string, chatId: string): Chat | null => {
  const e = engagementById(s, engId); if (!e) return null
  return e.chats.find(c => c.id === chatId) || null
}

export const monogram = (name: string): string => {
  const w = (name || '').trim().split(/\s+/).filter(Boolean)
  const str = ((w[0] || '')[0] || '') + ((w[1] || '')[0] || '')
  return (str || (name || '').slice(0, 2)).toUpperCase()
}
export const phaseLabel = (eng: Engagement | null, id: string): string =>
  (eng?.phases.find(p => p.id === id) || { label: '' }).label
export const statusColor = (st: string): string => (st === 'Complete' ? '#46c47f' : '#e6a23c')
export const sevColor = (sev: Severity): string =>
  ({ Critical: '#f0616d', High: '#f0954a', Medium: '#e6b23f', Low: '#7c828b' } as const)[sev]
```

- [ ] **Step 4: Write `src/state/reducer.ts`**

Port the prototype navigation/mutation methods. The reducer clones the parts of `data` it mutates (immutable at the top level so React re-renders; deep-mutate-then-clone-root is acceptable for M1 given the prototype used mutation + `forceUpdate`). Full code:

```ts
import type { AppState } from './selectors'
import { activeCompany, activeEngagement, engagementById, chatByIds } from './selectors'
import type { UIState } from './types'
import type { Chat, Message } from '../../electron/services/store.types'
import { chatColors } from '../../electron/services/seed'

let _id = 1000
const nextId = (p: string) => p + (++_id)

export const initialUI: UIState = {
  view: 'home', activeCompanyId: null, activeEngagementId: null, activeChatByEngagement: {},
  draft: '', rightOpen: true, editingName: false, nameDraft: '', colorMenuOpen: false,
  newProjectOpen: false, newCompanyName: '', newOpen: false, selectedType: 'aws', newName: '',
  newChatOpen: false, newChatName: '', newChatFocus: '', newChatColor: '#0a0b0d',
  ctxMenu: { open: false, x: 0, y: 0, engId: null, chatId: null },
  terminalOpen: false, terminalShell: 'pwsh', terminalHeight: 346, terminalInput: '',
  settingsOpen: false,
}

// Build the initial active-chat map from seed (first chat of each engagement).
export function initialActiveMap(s: AppState): Record<string, string> {
  const map: Record<string, string> = {}
  s.data.companies.forEach(c => c.engagements.forEach(e => { if (e.chats[0]) map[e.id] = e.chats[0].id }))
  return map
}

function makeChat(state: AppState, engId: string, phaseId: string, name: string, color: string): Chat {
  const eng = engagementById(state, engId)!
  const cfg = state.data.types[eng.type]
  const ph = cfg.phases.find(p => p.id === phaseId) || cfg.phases[0]
  const greeting: Message = { id: nextId('m'), role: 'assistant', kind: 'text',
    content: "I'm the " + ph.label + " agent for this " + cfg.label + ". Ask me to enumerate configuration, run automated checks, or log findings — this chat keeps its own context." }
  return { id: nextId('ch'), name: name || ph.label, phaseId: ph.id, color: color || '#0a0b0d', messages: [greeting], findings: [], tools: cfg.tools.map(t => ({ ...t })) }
}

export type Action =
  | { t: 'hydrate'; data: AppState['data'] }
  | { t: 'openCompany'; id: string } | { t: 'goHome' }
  | { t: 'selectEngagement'; id: string } | { t: 'selectChat'; id: string }
  | { t: 'toggleRight' }
  | { t: 'openNewProject' } | { t: 'closeNewProject' } | { t: 'setNewCompanyName'; value: string } | { t: 'createCompany' }
  | { t: 'openNew' } | { t: 'closeNew' } | { t: 'setSelectedType'; id: string } | { t: 'setNewName'; value: string } | { t: 'createProject' }
  | { t: 'openNewChat'; engId?: string } | { t: 'closeNewChat' } | { t: 'setNewChatName'; value: string } | { t: 'setNewChatFocus'; id: string } | { t: 'setNewChatColor'; bg: string } | { t: 'createChat' }
  | { t: 'startRename' } | { t: 'setNameDraft'; value: string } | { t: 'saveName' } | { t: 'cancelRename' }
  | { t: 'setChatColor'; bg: string }
  | { t: 'openCtx'; x: number; y: number; engId: string; chatId: string } | { t: 'closeCtx' } | { t: 'ctxRename' } | { t: 'ctxSetColor'; bg: string } | { t: 'ctxDelete'; engId: string; chatId: string }
  | { t: 'setDraft'; value: string }
  | { t: 'toggleTerminal' } | { t: 'closeTerminal' } | { t: 'setTerminalShell'; id: UIState['terminalShell'] } | { t: 'setTerminalInput'; value: string } | { t: 'setTerminalHeight'; h: number }
  | { t: 'openSettings' } | { t: 'closeSettings' }
  | { t: 'replaceData'; data: AppState['data'] }

const clone = (s: AppState): AppState => ({ data: { ...s.data, companies: s.data.companies.map(c => ({ ...c, engagements: c.engagements.map(e => ({ ...e, chats: e.chats.map(ch => ({ ...ch, messages: [...ch.messages], findings: [...ch.findings], tools: [...ch.tools] })) })) })) }, ui: { ...s.ui } })

export function reducer(state: AppState, a: Action): AppState {
  const s = clone(state)
  const U = s.ui
  switch (a.t) {
    case 'openCompany': {
      const c = s.data.companies.find(x => x.id === a.id)
      const first = c && c.engagements[0]
      U.view = 'workspace'; U.activeCompanyId = a.id; U.activeEngagementId = first ? first.id : null
      U.editingName = false; U.colorMenuOpen = false
      c?.engagements.forEach(e => { if (!U.activeChatByEngagement[e.id] && e.chats[0]) U.activeChatByEngagement[e.id] = e.chats[0].id })
      return s
    }
    case 'goHome': U.view = 'home'; U.editingName = false; U.colorMenuOpen = false; return s
    case 'selectEngagement': {
      const e = engagementById(s, a.id)
      if (e && !U.activeChatByEngagement[e.id] && e.chats[0]) U.activeChatByEngagement[e.id] = e.chats[0].id
      U.activeEngagementId = a.id; U.editingName = false; U.colorMenuOpen = false; return s
    }
    case 'selectChat': U.activeChatByEngagement[U.activeEngagementId!] = a.id; U.editingName = false; U.colorMenuOpen = false; return s
    case 'toggleRight': U.rightOpen = !U.rightOpen; return s
    case 'openNewProject': U.newProjectOpen = true; U.newCompanyName = ''; return s
    case 'closeNewProject': U.newProjectOpen = false; return s
    case 'setNewCompanyName': U.newCompanyName = a.value; return s
    case 'createCompany': {
      const name = U.newCompanyName.trim(); if (!name) return state
      const id = nextId('c')
      s.data.companies = [{ id, name, updated: 'just now', engagements: [] }, ...s.data.companies]
      U.newProjectOpen = false; U.view = 'workspace'; U.activeCompanyId = id; U.activeEngagementId = null; U.editingName = false; return s
    }
    case 'openNew': U.newOpen = true; U.selectedType = 'aws'; U.newName = ''; return s
    case 'closeNew': U.newOpen = false; return s
    case 'setSelectedType': U.selectedType = a.id; return s
    case 'setNewName': U.newName = a.value; return s
    case 'createProject': {
      const cfg = s.data.types[U.selectedType as keyof typeof s.data.types]
      const eng = { id: nextId('e'), type: U.selectedType as any, name: U.newName.trim() || cfg.label, status: 'In Progress' as const, updated: 'just now', linear: cfg.linear, phases: cfg.phases, scope: cfg.scope.map(x => ({ ...x })), chats: [] }
      const c = activeCompany(s)!; c.updated = 'just now'; c.engagements = [eng, ...c.engagements]
      U.activeEngagementId = eng.id; U.newOpen = false; U.editingName = false; return s
    }
    case 'openNewChat': {
      const id = a.engId || U.activeEngagementId; const eng = id ? engagementById(s, id) : null; if (!eng) return state
      U.activeEngagementId = eng.id; U.newChatOpen = true; U.newChatName = ''; U.newChatFocus = eng.phases[0].id; U.newChatColor = '#0a0b0d'; return s
    }
    case 'closeNewChat': U.newChatOpen = false; return s
    case 'setNewChatName': U.newChatName = a.value; return s
    case 'setNewChatFocus': U.newChatFocus = a.id; return s
    case 'setNewChatColor': U.newChatColor = a.bg; return s
    case 'createChat': {
      const eng = activeEngagement(s); if (!eng) return state
      const chat = makeChat(s, eng.id, U.newChatFocus, U.newChatName.trim(), U.newChatColor)
      eng.chats = [chat, ...eng.chats]; eng.updated = 'just now'
      U.activeChatByEngagement[eng.id] = chat.id; U.newChatOpen = false; U.editingName = false; return s
    }
    case 'startRename': { const c = chatByIds(s, U.activeEngagementId!, U.activeChatByEngagement[U.activeEngagementId!]); if (c) { U.editingName = true; U.nameDraft = c.name; U.colorMenuOpen = false } return s }
    case 'setNameDraft': U.nameDraft = a.value; return s
    case 'saveName': { if (!U.editingName) return state; const name = U.nameDraft.trim(); const c = chatByIds(s, U.activeEngagementId!, U.activeChatByEngagement[U.activeEngagementId!]); if (c && name) c.name = name; U.editingName = false; return s }
    case 'cancelRename': U.editingName = false; return s
    case 'setChatColor': { const c = chatByIds(s, U.activeEngagementId!, U.activeChatByEngagement[U.activeEngagementId!]); if (c) c.color = a.bg; U.colorMenuOpen = false; return s }
    case 'openCtx': U.ctxMenu = { open: true, x: a.x, y: a.y, engId: a.engId, chatId: a.chatId }; U.colorMenuOpen = false; return s
    case 'closeCtx': U.ctxMenu = { ...U.ctxMenu, open: false }; return s
    case 'ctxRename': { const { engId, chatId } = U.ctxMenu; const c = chatByIds(s, engId!, chatId!); if (!c) return state; U.activeEngagementId = engId; U.activeChatByEngagement[engId!] = chatId!; U.editingName = true; U.nameDraft = c.name; U.ctxMenu = { ...U.ctxMenu, open: false }; return s }
    case 'ctxSetColor': { const { engId, chatId } = U.ctxMenu; const c = chatByIds(s, engId!, chatId!); if (c) c.color = a.bg; U.ctxMenu = { ...U.ctxMenu, open: false }; return s }
    case 'ctxDelete': { const e = engagementById(s, a.engId); if (!e) return state; e.chats = e.chats.filter(c => c.id !== a.chatId); if (U.activeChatByEngagement[a.engId] === a.chatId) { if (e.chats[0]) U.activeChatByEngagement[a.engId] = e.chats[0].id; else delete U.activeChatByEngagement[a.engId] } U.ctxMenu = { ...U.ctxMenu, open: false }; return s }
    case 'setDraft': U.draft = a.value; return s
    case 'toggleTerminal': U.terminalOpen = !U.terminalOpen; return s
    case 'closeTerminal': U.terminalOpen = false; return s
    case 'setTerminalShell': U.terminalShell = a.id; return s
    case 'setTerminalInput': U.terminalInput = a.value; return s
    case 'setTerminalHeight': U.terminalHeight = a.h; return s
    case 'openSettings': U.settingsOpen = true; return s
    case 'closeSettings': U.settingsOpen = false; return s
    case 'replaceData': case 'hydrate': s.data = a.data; return s
    default: return state
  }
}
export { chatColors }
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd redcell && npx vitest run test/reducer.test.ts`
Expected: PASS (5 tests). (`nextId` starting at 1000 avoids colliding with seed ids.)

- [ ] **Step 6: Commit**

```bash
git add redcell && git commit -m "feat: renderer reducer + selectors ported from prototype logic"
```

---

### Task 5: Theme + Hoverable helper + App wiring (Home renders live)

**Files:**
- Create: `redcell/src/theme.ts`, `redcell/src/components/Hoverable.tsx`
- Modify: `redcell/src/App.tsx`
- Create: `redcell/src/screens/Home.tsx`, `redcell/src/components/modals/NewProjectModal.tsx`

**Interfaces:**
- Consumes: reducer/selectors (Task 4), `getSnapshot` (Task 3).
- Produces: `theme` constants; `<Hoverable as="button" baseStyle hoverStyle>`; `App` that hydrates snapshot into `useReducer` and renders Home; `Home` + `NewProjectModal`.

- [ ] **Step 1: Write `src/theme.ts`**

```ts
export const theme = {
  bg: '#0a0b0d', panel: '#0c0d10', panel2: '#0d0e11', card: '#101216', card2: '#111318',
  input: '#15171c', term: '#070809',
  text: '#e7e9ec', textDim: '#c9cdd4', muted: '#8b929c', muted2: '#9096a0', dim: '#656b74', dim2: '#565c65',
  accent: '#6f7bf0', accentHover: '#5866f0', accentSoft: '#9aa2f5', accentSoft2: '#aab0f7',
  ok: '#46c47f', ok2: '#5bd493', warn: '#e6a23c',
  sans: "'IBM Plex Sans',system-ui,sans-serif", mono: "'IBM Plex Mono',monospace",
  border: 'rgba(255,255,255,0.07)', border2: 'rgba(255,255,255,0.1)',
}
```

- [ ] **Step 2: Write `src/components/Hoverable.tsx`**

Reproduces the prototype's `style-hover`. Full code:
```tsx
import React, { useState } from 'react'
type Props = React.HTMLAttributes<HTMLElement> & {
  as?: 'button' | 'div' | 'span'; baseStyle: React.CSSProperties; hoverStyle?: React.CSSProperties
  title?: string; onClick?: (e: any) => void; onContextMenu?: (e: any) => void; disabled?: boolean; type?: 'button'
}
export function Hoverable({ as = 'div', baseStyle, hoverStyle, children, ...rest }: Props) {
  const [h, setH] = useState(false)
  const Tag = as as any
  return <Tag {...rest} style={{ ...baseStyle, ...(h && hoverStyle ? hoverStyle : {}) }}
    onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}>{children}</Tag>
}
```

- [ ] **Step 3: Write `src/App.tsx`**

```tsx
import { useEffect, useReducer } from 'react'
import { reducer, initialUI, initialActiveMap } from './state/reducer'
import type { AppState } from './state/selectors'
import { getSnapshot } from './ipc'
import { Home } from './screens/Home'
import { Workspace } from './screens/Workspace' // added in Task 7

const empty: AppState = { data: { companies: [], types: {} as any }, ui: initialUI }

export default function App() {
  const [state, dispatch] = useReducer(reducer, empty)
  useEffect(() => { getSnapshot().then(data => {
    const seeded: AppState = { data, ui: initialUI }
    dispatch({ t: 'hydrate', data })
    dispatch({ t: 'seedActiveMap', map: initialActiveMap(seeded) } as any)
  }) }, [])
  if (state.ui.view === 'home') return <Home state={state} dispatch={dispatch} />
  return <Workspace state={state} dispatch={dispatch} />
}
```

Add the `seedActiveMap` action to the reducer's `Action` union and switch: `case 'seedActiveMap': U.activeChatByEngagement = a.map; return s` (with `{ t: 'seedActiveMap'; map: Record<string,string> }` in the union).

- [ ] **Step 4: Write `src/screens/Home.tsx` and `NewProjectModal.tsx`**

Port the `<!-- HOME / MAIN MENU -->` section and `<!-- NEW PROJECT MODAL -->` from `design-reference/Redcell.dc.html` exactly (header with ◆ logo + REDCELL wordmark, Projects heading, New Project button, company card grid with type chips + New Project dashed card). Props: `{ state: AppState; dispatch: React.Dispatch<Action> }`. Derive card view-models with `monogram`, `statusColor`, `state.data.types[e.type].short`. Chips use `statusColor(e.status)`. Wire `onClick` → `dispatch({t:'openCompany', id})`, New Project → `dispatch({t:'openNewProject'})`. Render `<NewProjectModal>` when `ui.newProjectOpen`. The modal ports the New Project modal markup; input → `setNewCompanyName`, Enter → `createCompany`, Escape/Cancel → `closeNewProject`.

Representative card mapping (styling ported verbatim from the reference):
```tsx
const companies = state.data.companies.map(c => ({
  id: c.id, name: c.name,
  engCountLabel: c.engagements.length + (c.engagements.length === 1 ? ' engagement' : ' engagements'),
  updated: c.updated, empty: c.engagements.length === 0,
  chips: c.engagements.slice(0, 5).map(e => ({ short: state.data.types[e.type].short, color: statusColor(e.status) })),
}))
```

- [ ] **Step 5: Temporary Workspace stub so App compiles**

Create `src/screens/Workspace.tsx` with a placeholder (replaced in Task 7):
```tsx
import type { AppState } from '../state/selectors'
export function Workspace(_: { state: AppState; dispatch: any }) { return <div style={{ padding: 40 }}>Workspace…</div> }
```

- [ ] **Step 6: Run the app**

Run: `cd redcell && npm run dev`
Expected: Home screen renders with 3 seeded company cards (Acme/Contoso/Globex) with correct chips; "New Project" opens the modal; creating a company navigates to the (stub) workspace.

- [ ] **Step 7: Commit**

```bash
git add redcell && git commit -m "feat: theme, App hydration, Home screen + New Project modal"
```

---

### Task 6: Workspace shell + Sidebar

**Files:**
- Modify: `redcell/src/screens/Workspace.tsx`
- Create: `redcell/src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: reducer/selectors, theme.
- Produces: `Workspace` full layout (sidebar + main slot + right slot + terminal slot placeholders); `Sidebar`.

- [ ] **Step 1: Port the Sidebar**

Port the `<aside data-screen-label="Engagements sidebar">` block verbatim from the reference. Props `{ state, dispatch }`. Build the `engagements` view-model exactly as the prototype's `renderVals()` does (name, `types[e.type].short`, `chatCountLabel`, `isActive`, `statusColor`, `noChats`, nested `chats` with `focusLabel = phaseLabel(e, ch.phaseId)`, `dot = colorDot(ch.color)`, `isActive`, `nameColor`). Wire: back button → `goHome`; New Engagement → `openNew`; engagement click → `selectEngagement`; chat click → `selectChat`; chat right-click → `openCtx` with `e.clientX/clientY` clamped as in `onChatContext` (`w=198,h=240,pad=12`); New chat → `openNewChat`. `colorDot(bg)` = `chatColors.find(c=>c.bg===bg)?.dot ?? chatColors[0].dot`.

- [ ] **Step 2: Write `Workspace.tsx` layout**

Port `<!-- WORKSPACE -->`'s outer `<div style="display:flex;height:100vh...">`. Compose `<Sidebar>`, a `<main>` that will hold `<ChatPane>` (Task 8) — for now render the three empty states (`noEngagement`, `engNoChats`) from the reference and a placeholder where the chat goes — plus slots for `<ContextPanel>` (Task 9) and `<TerminalDock>` (Task 12). Compute `noEngagement/engNoChats/hasChat` exactly as `renderVals` does.

- [ ] **Step 3: Run the app**

Run: `cd redcell && npm run dev`
Expected: Opening Acme shows the sidebar with AWS + Internal engagements, nested chats under the active one; the M365-only company (Contoso→M365) shows the "No chats" states correctly; clicking engagements/chats updates active highlighting.

- [ ] **Step 4: Commit**

```bash
git add redcell && git commit -m "feat: workspace layout + engagements sidebar"
```

---

### Task 7: ChatPane + MessageList + ToolCard + Composer (static render)

**Files:**
- Create: `redcell/src/components/ChatPane.tsx`, `MessageList.tsx`, `ToolCard.tsx`, `Composer.tsx`
- Modify: `redcell/src/screens/Workspace.tsx`
- Test: `redcell/test/ToolCard.test.tsx`

**Interfaces:**
- Consumes: `activeChat`, `phaseLabel`, `sevColor`, theme.
- Produces: `ChatPane`, `ToolCard` (props below).

`ToolCard` props:
```ts
interface ToolCardProps {
  running: boolean; success: boolean; unavailable: boolean
  command?: string; output?: string; duration?: string
  toolName?: string; reason?: string; installCmd?: string
  onInstall?: () => void
}
```

- [ ] **Step 1: Write the failing test `test/ToolCard.test.tsx`**

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ToolCard } from '../src/components/ToolCard'

describe('ToolCard', () => {
  it('shows Running state with the command', () => {
    render(<ToolCard running success={false} unavailable={false} command="nmap -sn 10.0.0.0/24" />)
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('nmap -sn 10.0.0.0/24')).toBeInTheDocument()
  })
  it('shows success output + duration', () => {
    render(<ToolCard running={false} success unavailable={false} command="cmd" output="done" duration="7.4s" />)
    expect(screen.getByText('done')).toBeInTheDocument()
    expect(screen.getByText('7.4s')).toBeInTheDocument()
  })
  it('shows an Install button when unavailable', () => {
    render(<ToolCard running={false} success={false} unavailable toolName="pmapper" reason="not installed" installCmd="pip install principalmapper" />)
    expect(screen.getByText(/Install/)).toBeInTheDocument()
    expect(screen.getByText('pip install principalmapper')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd redcell && npx vitest run test/ToolCard.test.tsx`
Expected: FAIL — `ToolCard` not found.

- [ ] **Step 3: Write `ToolCard.tsx`**

Port the three tool-state blocks (`m.running` spinner card, `m.success` card with header + `<pre>` output, `m.unavailable` amber card with Install/Learn more) from the message loop in the reference, exactly. Install button → `props.onInstall`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd redcell && npx vitest run test/ToolCard.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Write `MessageList.tsx` + `Composer.tsx` + `ChatPane.tsx`**

`MessageList`: map `chat.messages` to the three renders — assistant text (◆ avatar + text), user bubble, and `<ToolCard>` for `kind==='tool'` (props from `state`/fields). Auto-scroll to bottom on messages change via a `ref` + `useEffect`. `Composer`: port the composer (attach button, terminal toggle button, send button, input); input → `setDraft`, Enter (no shift) → `onSend` (wired in Task 11; for now `onSend` is a passed prop, default no-op), terminal button → `toggleTerminal`. `ChatPane`: header (rename input ↔ name + pencil + focus badge + breadcrumb, Context toggle button when `rightOpen`), `<MessageList>`, `<Composer>`. Wire rename via `startRename/saveName/cancelRename/setNameDraft`. Replace the chat placeholder in `Workspace.tsx` with `<ChatPane>` when `hasChat`.

- [ ] **Step 6: Run the app**

Run: `cd redcell && npm run dev`
Expected: Acme→AWS→"IAM privilege review" shows the full seeded conversation including the Prowler success card and the PMapper unavailable card; the Internal→Exploit chat shows the hashcat unavailable card. Rename works.

- [ ] **Step 7: Commit**

```bash
git add redcell && git commit -m "feat: chat pane, message list, tool cards, composer"
```

---

### Task 8: ContextPanel + collapsed rail

**Files:**
- Create: `redcell/src/components/ContextPanel.tsx`
- Modify: `redcell/src/screens/Workspace.tsx`

**Interfaces:**
- Consumes: `activeChat`, `activeEngagement`, `sevColor`, theme.

- [ ] **Step 1: Port the ContextPanel**

Port `<!-- RIGHT PANEL -->` and `<!-- COLLAPSED RAIL -->` verbatim. Props `{ state, dispatch }`. Build `scope = activeEngagement(s).scope`; `findings = activeChat(s).findings` mapped with `sevColor`; `tools = activeChat(s).tools` mapped to `{ name, statusLabel: available?'available':'missing', color: available?'#46c47f':'#e6a23c' }`; `findingsCount`, `findingsEmpty`. Show panel when `hasChat && ui.rightOpen`; show rail when `hasChat && !ui.rightOpen`. Toggle → `toggleRight`.

- [ ] **Step 2: Mount in Workspace**

Add `<ContextPanel>` after `<main>` in `Workspace.tsx`.

- [ ] **Step 3: Run the app**

Run: `cd redcell && npm run dev`
Expected: right panel shows Scope (Account/Regions/…), the 4 IAM findings with correct severity colours, and the tool list with prowler/aws-cli available + pmapper missing; the Context toggle collapses it to the vertical rail and back.

- [ ] **Step 4: Commit**

```bash
git add redcell && git commit -m "feat: context panel (scope/findings/tools) + collapsed rail"
```

---

### Task 9: New Engagement + New Chat modals + Chat context menu

**Files:**
- Create: `redcell/src/components/modals/NewEngagementModal.tsx`, `NewChatModal.tsx`, `redcell/src/components/ContextMenu.tsx`
- Modify: `redcell/src/screens/Workspace.tsx`

**Interfaces:**
- Consumes: reducer actions, `phaseLabel`, `chatColors`.

- [ ] **Step 1: Port `NewEngagementModal`**

Port `<!-- NEW ENGAGEMENT MODAL -->`. `reviewTypes` from `Object.keys(state.data.types)` → `{ id, label, desc: linear ? 'Recon → Exploit' : phases.map(x=>x.label).join(' · '), selected: id===ui.selectedType }`. Radio select → `setSelectedType`; name input → `setNewName`; Create → `createProject`; Cancel/backdrop → `closeNew`. Placeholder for the name input = `state.data.types[ui.selectedType].label`.

- [ ] **Step 2: Port `NewChatModal`**

Port `<!-- NEW CHAT MODAL -->`. `chatFocusOptions` from `activeEngagement(s).phases` → `{ id, label, selected: id===ui.newChatFocus }` → `setNewChatFocus`. Name → `setNewChatName`; Enter → `createChat`. Colour picker from `chatColors` (bg/dot/selected) → `setNewChatColor`. Create → `createChat`; Cancel/backdrop → `closeNewChat`. Placeholder = `phaseLabel(activeEngagement, ui.newChatFocus)`.

- [ ] **Step 3: Port `ContextMenu`**

Port `<!-- CHAT CONTEXT MENU -->`. Positioned at `ui.ctxMenu.x/y`. Rename → `ctxRename`; colour grid (6) → `ctxSetColor`; Delete → `ctxDelete` (with `engId/chatId` from `ui.ctxMenu`). Backdrop click/contextmenu → `closeCtx`.

- [ ] **Step 4: Mount all three in `Workspace.tsx`** gated on `ui.newOpen`, `ui.newChatOpen`, `ui.ctxMenu.open`.

- [ ] **Step 5: Run the app**

Run: `cd redcell && npm run dev`
Expected: "New Engagement" lists all 5 types with correct phase descriptions and creates one; "New chat" creates a focused chat that becomes active; right-clicking a chat opens the menu and rename/recolour/delete all work.

- [ ] **Step 6: Commit**

```bash
git add redcell && git commit -m "feat: new-engagement, new-chat modals + chat context menu"
```

---

### Task 10: AgentService mock + send/install flow

**Files:**
- Create: `redcell/electron/services/agent.mock.ts`
- Modify: `redcell/electron/main.ts`, `redcell/electron/preload.ts`, `redcell/src/ipc.ts`, `redcell/src/components/Composer.tsx`, `redcell/src/components/ChatPane.tsx`, `redcell/src/App.tsx`
- Test: `redcell/test/agent.mock.test.ts`

**Interfaces:**
- Consumes: `AgentSendRequest`, `AgentInstallRequest`, `AgentEvent`.
- Produces: `runSend(req, emit)`, `runInstall(req, emit)`; `window.redcell.agent.send/install`; `sendMessage`/`installTool` in `ipc.ts` that append resulting events to the reducer's active chat.

The mock reproduces the prototype's `send()` sequence (user msg is added by the reducer before calling; the agent emits: text "On it — running a targeted check for the {phase} phase.", then a running tool card, then after 1.5s success with `Completed 128 checks · 3 notable · 0 errors` @ `7.4s`, then after 0.5s a follow-up text) and `install()` (running → success `Successfully installed {tool}` → confirmation text + marks tool available). Emit via callback; in tests use fake timers.

- [ ] **Step 1: Write failing test `test/agent.mock.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { runSend } from '../electron/services/agent.mock'
import type { AgentEvent } from '../electron/services/agent.types'

describe('agent mock send', () => {
  it('emits text, running tool, success tool, follow-up, done', async () => {
    vi.useFakeTimers()
    const events: AgentEvent[] = []
    const p = runSend({ chatId: 'ch1', engagementType: 'internal', phaseLabel: 'Recon', primaryTool: 'nmap', text: 'go' }, e => events.push(e))
    await vi.runAllTimersAsync(); await p
    const types = events.map(e => e.type)
    expect(types[0]).toBe('text')
    expect(events.some(e => e.type === 'tool_call' && e.state === 'running')).toBe(true)
    expect(events.some(e => e.type === 'tool_call' && e.state === 'success')).toBe(true)
    expect(types[types.length - 1]).toBe('done')
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd redcell && npx vitest run test/agent.mock.test.ts`
Expected: FAIL — `runSend` not found.

- [ ] **Step 3: Write `agent.mock.ts`**

```ts
import type { AgentEvent, AgentSendRequest, AgentInstallRequest } from './agent.types'
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export async function runSend(req: AgentSendRequest, emit: (e: AgentEvent) => void): Promise<void> {
  await wait(450)
  emit({ type: 'text', text: 'On it — running a targeted check for the ' + req.phaseLabel + ' phase.' })
  emit({ type: 'tool_call', state: 'running', toolName: req.primaryTool, command: req.primaryTool + ' --scope in-scope --profile quick' })
  await wait(1500)
  emit({ type: 'tool_call', state: 'success', toolName: req.primaryTool, command: req.primaryTool + ' --scope in-scope --profile quick', duration: '7.4s', output: 'Completed 128 checks · 3 notable · 0 errors' })
  await wait(500)
  emit({ type: 'text', text: 'Done — the notable items are logged in the findings panel on the right. Want me to dig into any of them?' })
  emit({ type: 'done' })
}

export async function runInstall(req: AgentInstallRequest, emit: (e: AgentEvent) => void): Promise<void> {
  emit({ type: 'tool_call', state: 'running', toolName: req.toolName, command: req.installCmd || ('install ' + req.toolName) })
  await wait(1400)
  emit({ type: 'tool_call', state: 'success', toolName: req.toolName, command: req.installCmd || ('install ' + req.toolName), duration: '11.2s', output: 'Collecting ' + req.toolName + '...\nSuccessfully installed ' + req.toolName })
  emit({ type: 'text', text: req.toolName + ' installed and now available in this chat. I can re-run the analysis whenever you are ready.' })
  emit({ type: 'done' })
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd redcell && npx vitest run test/agent.mock.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire IPC (streaming via a per-call channel)**

In `main.ts`: register `ipcMain.handle('agent:send', (ev, req) => runSend(req, e => ev.sender.send('agent:event:' + req.chatId, e)))` and the same for `agent:install`. In `preload.ts`, add:
```ts
agent: {
  send: (req: any, onEvent: any) => { const ch = 'agent:event:' + req.chatId; const l = (_: any, e: any) => onEvent(e); ipcRenderer.on(ch, l); return ipcRenderer.invoke('agent:send', req).finally(() => ipcRenderer.removeListener(ch, l)) },
  install: (req: any, onEvent: any) => { const ch = 'agent:event:' + req.chatId; const l = (_: any, e: any) => onEvent(e); ipcRenderer.on(ch, l); return ipcRenderer.invoke('agent:install', req).finally(() => ipcRenderer.removeListener(ch, l)) },
},
```

- [ ] **Step 6: Reducer actions to apply agent events**

Add reducer actions: `{ t: 'appendUserMessage'; chatId: string; text: string }`, `{ t: 'appendText'; chatId: string; text: string }`, `{ t: 'upsertToolCard'; chatId: string; card: Message }` (running then replaced by success — match on a client id you pass), `{ t: 'markToolAvailable'; chatId: string; toolName: string }`. Each finds the chat by scanning companies/engagements (add a `chatByGlobalId` selector) and mutates its `messages`/`tools`. Wire `sendMessage(dispatch, chat, eng)` in `ipc.ts`: dispatch `appendUserMessage`, then call `window.redcell.agent.send({...}, e => applyEvent(dispatch, chat.id, e))`. `applyEvent` maps `text`→append assistant text, `tool_call running`→append a tool card (assign a stable id), `tool_call success`→replace the last running card for that tool, `finding`→append finding, `done`→noop. Wire Composer `onSend` and ToolCard `onInstall` through these.

- [ ] **Step 7: Run the app**

Run: `cd redcell && npm run dev`
Expected: typing a message and pressing Enter appends the user bubble, then streams the assistant text + running→success tool card + follow-up. Clicking Install on the PMapper card runs the install animation and flips the tool to available in the panel.

- [ ] **Step 8: Commit**

```bash
git add redcell && git commit -m "feat: agent mock streaming + send/install wiring"
```

---

### Task 11: ShellService mock + TerminalDock

**Files:**
- Create: `redcell/electron/services/shell.mock.ts`, `redcell/src/components/TerminalDock.tsx`
- Modify: `redcell/electron/main.ts`, `redcell/electron/preload.ts`, `redcell/src/ipc.ts`, `redcell/src/screens/Workspace.tsx`, `redcell/src/App.tsx`
- Test: `redcell/test/shell.mock.test.ts`

**Interfaces:**
- Consumes: `ShellId`, `ShellRunResult`, `ShellTab`.
- Produces: `runShell(shell, raw): ShellRunResult`, `shellTabs()`, `shellPrompt(shell)`; `window.redcell.shell.*`.

- [ ] **Step 1: Write failing test `test/shell.mock.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { runShell } from '../electron/services/shell.mock'

describe('shell mock', () => {
  it('help lists demo commands', () => { expect(runShell('pwsh', 'help').lines[0].text).toMatch(/Demo commands/) })
  it('whoami differs by shell', () => {
    expect(runShell('kali', 'whoami').lines[0].text).toBe('kali')
    expect(runShell('pwsh', 'whoami').lines[0].text).toBe('desktop-pt01\\pentester')
  })
  it('clear returns a clear directive', () => { expect(runShell('cmd', 'cls').clear).toBe(true) })
  it('nmap echoes the target', () => { expect(runShell('kali', 'nmap 10.0.0.9').lines[0].text).toMatch(/10.0.0.9/) })
  it('unknown command errors per shell', () => { expect(runShell('cmd', 'frobnicate').lines[0].text).toMatch(/not recognized/) })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd redcell && npx vitest run test/shell.mock.test.ts`
Expected: FAIL — `runShell` not found.

- [ ] **Step 3: Write `shell.mock.ts`**

Port `terminalOutput()`, `shellPromptStored()`, `inlinePrompt()`, `shellColor()`, and `terminalShells` from the reference into pure functions. Full code:

```ts
import type { ShellId, ShellRunResult, ShellTab, ShellLine } from './shell.types'
import { terminalShells } from './seed'

export const shellTabs = (): ShellTab[] => terminalShells.map(s => ({ ...s }))
export const shellColor = (shell: ShellId) => terminalShells.find(s => s.id === shell)?.color || '#9aa2f5'
export const shellPromptStored = (shell: ShellId) => shell === 'kali' ? '┌──(kali㉿kali)-[~]\n└─$' : shell === 'cmd' ? 'C:\\Users\\pentester>' : 'PS C:\\Users\\pentester>'
export const inlinePrompt = (shell: ShellId) => shell === 'kali' ? '└─$' : shell === 'cmd' ? 'C:\\Users\\pentester>' : 'PS C:\\Users\\pentester>'

export function runShell(shell: ShellId, raw: string): ShellRunResult {
  const parts = raw.trim().split(/\s+/); const cmd = (parts[0] || '').toLowerCase()
  const out = (text: string): ShellLine => ({ kind: 'out', text })
  if (cmd === 'clear' || cmd === 'cls') return { lines: [], clear: true }
  if (cmd === 'help') return { lines: [out('Demo commands: whoami · pwd · ls / dir · ipconfig / ifconfig · nmap <target> · nikto · clear\nAnything else returns a realistic shell response. This is a UI mock — no real commands execute.')] }
  if (cmd === 'whoami') return { lines: [out(shell === 'kali' ? 'kali' : 'desktop-pt01\\pentester')] }
  if (cmd === 'pwd') return { lines: [out(shell === 'kali' ? '/home/kali' : 'C:\\Users\\pentester')] }
  if (cmd === 'ls' || cmd === 'dir') {
    if (shell === 'kali') return { lines: [out('Desktop   Documents   loot   scans   wordlists')] }
    return { lines: [out(' Directory: C:\\Users\\pentester\n\nMode    LastWriteTime        Length Name\n----    -------------        ------ ----\nd----   6/28/2026   9:14 AM          loot\nd----   6/28/2026   9:02 AM          scans\n-a---   6/30/2026   4:41 PM    2088  scope.txt')] }
  }
  if (cmd === 'ipconfig' || cmd === 'ifconfig' || cmd === 'ip') {
    if (shell === 'kali') return { lines: [out('eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500\n        inet 10.10.14.7  netmask 255.255.0.0  broadcast 10.10.255.255\n        ether 00:15:5d:6a:12:0b  txqueuelen 1000  (Ethernet)')] }
    return { lines: [out('Windows IP Configuration\n\nEthernet adapter Ethernet:\n   IPv4 Address. . . . . . . : 10.10.14.7\n   Subnet Mask . . . . . . . : 255.255.0.0\n   Default Gateway . . . . . : 10.10.0.1')] }
  }
  if (cmd === 'nmap') {
    const tgt = parts.slice(1).find(p => !p.startsWith('-')) || '10.10.0.5'
    return { lines: [out('Starting Nmap 7.94 ( https://nmap.org )\nNmap scan report for ' + tgt + '\nHost is up (0.0021s latency).\n\nPORT     STATE SERVICE\n22/tcp   open  ssh\n135/tcp  open  msrpc\n445/tcp  open  microsoft-ds\n3389/tcp open  ms-wbt-server\n\nNmap done: 1 IP address (1 host up) scanned in 4.30s')] }
  }
  if (cmd === 'nikto') return { lines: [out('- Nikto v2.5.0\n+ Target IP:          10.10.14.7\n+ Server: nginx/1.24.0\n+ /admin/: Admin login page identified.\n+ 7 host(s) tested')] }
  if (cmd === '') return { lines: [] }
  if (shell === 'kali') return { lines: [out(parts[0] + ': command not found')] }
  if (shell === 'cmd') return { lines: [out("'" + parts[0] + "' is not recognized as an internal or external command,\noperable program or batch file.")] }
  return { lines: [out(parts[0] + " : The term '" + parts[0] + "' is not recognized as the name of a cmdlet, function, script file, or operable program.")] }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd redcell && npx vitest run test/shell.mock.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: IPC + preload**

`main.ts`: `ipcMain.handle('shell:run', (_e, { shell, raw }) => runShell(shell, raw))`, `ipcMain.handle('shell:tabs', () => shellTabs())`, `ipcMain.handle('shell:prompt', (_e, shell) => ({ stored: shellPromptStored(shell), inline: inlinePrompt(shell), color: shellColor(shell) }))`. `preload.ts`: add `shell: { tabs: () => ipcRenderer.invoke('shell:tabs'), run: (shell, raw) => ipcRenderer.invoke('shell:run', { shell, raw }), prompt: (shell) => ipcRenderer.invoke('shell:prompt', shell) }`.

- [ ] **Step 6: Write `TerminalDock.tsx`**

Port `<!-- TERMINAL DOCK -->` verbatim. Keep per-shell session buffers in component state, seeded from `buildTerminalSessions()` (import it — it's a pure function, safe in the renderer). Tabs from `window.redcell.shell.tabs()`. On Enter: push a `cmd` line (`prompt = shellPromptStored`, `promptColor = shellColor`), call `window.redcell.shell.run(shell, raw)`, then either clear the buffer (`clear`) or append the returned lines; auto-scroll. Drag handle resizes via `setTerminalHeight` (bounds `160..innerHeight-120`). Close → `closeTerminal`. Height from `ui.terminalHeight + 'px'`; active shell from `ui.terminalShell` via `setTerminalShell`.

- [ ] **Step 7: Mount + global Ctrl+\` toggle**

In `Workspace.tsx` render `<TerminalDock>` when `ui.terminalOpen`. In `App.tsx` add a `useEffect` keydown listener: `if ((e.ctrlKey||e.metaKey) && (e.key==='`'||e.key==='Backquote')) { e.preventDefault(); dispatch({t:'toggleTerminal'}) }`.

- [ ] **Step 8: Run the app**

Run: `cd redcell && npm run dev`
Expected: the terminal button in the composer and Ctrl+` both open the dock; switching PowerShell/CMD/Kali tabs keeps separate buffers; `help`, `whoami`, `nmap 10.0.0.9`, `cls`, and an unknown command all behave per-shell; drag-resize works; close hides it.

- [ ] **Step 9: Commit**

```bash
git add redcell && git commit -m "feat: shell mock + shared terminal dock with 3 shells"
```

---

### Task 12: Settings screen + provider/model + API-key fields (inert)

**Files:**
- Create: `redcell/src/components/Settings.tsx`
- Modify: `redcell/src/screens/Home.tsx` (add a gear entry), `redcell/src/App.tsx` or `Workspace.tsx` (mount when `ui.settingsOpen`)

**Interfaces:**
- Consumes: reducer `openSettings/closeSettings`.
- Produces: `Settings` modal. Stores selections in component state only (M1 inert; a later milestone persists to store + drives the agent).

- [ ] **Step 1: Write `Settings.tsx`**

A modal matching the app's modal styling (reuse the New Project modal's container styles from the reference). Fields: provider `<select>` (Anthropic (default) / OpenAI / Google / Ollama), model `<select>` whose options depend on provider (Anthropic: `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5`; others: a representative default each), and an API-key `<input type="password">` per hosted provider (Ollama shows a base-URL field instead). A note reading "Saved locally. Live model calls arrive in a later build." Close/backdrop → `closeSettings`. Default provider Anthropic, default model `claude-opus-4-8`.

- [ ] **Step 2: Add entry points**

Add a small gear button to the Home header (right side) → `dispatch({t:'openSettings'})`, and mount `{ui.settingsOpen && <Settings ... />}` at the App root so it's reachable from both screens.

- [ ] **Step 3: Run the app**

Run: `cd redcell && npm run dev`
Expected: gear opens Settings; changing provider updates the model list; typing a key persists while open; closing and reopening is fine. Nothing calls out (inert).

- [ ] **Step 4: Commit**

```bash
git add redcell && git commit -m "feat: inert Settings (provider/model/api-key) scaffolding"
```

---

### Task 13: TerminalDock behaviour test + full-run smoke + polish pass

**Files:**
- Test: `redcell/test/TerminalDock.test.tsx`
- Modify: any components needing fidelity fixes surfaced by the visual diff.

- [ ] **Step 1: Write `test/TerminalDock.test.tsx`**

Mock `window.redcell.shell` with the real `runShell`/`shellTabs`/prompt functions imported directly, render `<TerminalDock>` inside a minimal harness, type `whoami` + Enter, assert the output line appears; type `cls` + Enter, assert the buffer clears.

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { runShell, shellTabs, shellColor, shellPromptStored, inlinePrompt } from '../electron/services/shell.mock'
import { TerminalDock } from '../src/components/TerminalDock'
// stub window.redcell.shell before render
beforeEach(() => {
  ;(window as any).redcell = { shell: {
    tabs: async () => shellTabs(),
    run: async (s: any, r: any) => runShell(s, r),
    prompt: async (s: any) => ({ stored: shellPromptStored(s), inline: inlinePrompt(s), color: shellColor(s) }),
  } }
})
// ...render with a stub state (terminalOpen:true, terminalShell:'pwsh') + no-op dispatch, then:
// fireEvent.change(input,{target:{value:'whoami'}}); fireEvent.keyDown(input,{key:'Enter'})
// await screen.findByText(/pentester/)
```

Fill in the harness with a minimal `ui` object and a `dispatch = () => {}`; assert `await screen.findByText(/pentester/)` succeeds.

- [ ] **Step 2: Run the full test suite**

Run: `cd redcell && npm test`
Expected: all suites pass (store, reducer, agent, shell, ToolCard, TerminalDock).

- [ ] **Step 3: Visual diff pass**

Run `npm run dev`; walk every screen against `design-reference/Redcell.dc.html` (open it in a browser for side-by-side): Home, workspace with a rich chat, empty states, all three modals, context menu, context panel + rail, terminal with all shells, Settings. Fix any spacing/colour/font drift found. Verify on both macOS and Windows if available (at minimum the current OS).

- [ ] **Step 4: Commit**

```bash
git add redcell && git commit -m "test: terminal behaviour + full-run smoke; fidelity polish"
```

---

### Task 14: README + run docs

**Files:**
- Create: `redcell/README.md`

- [ ] **Step 1: Write `README.md`**

Document: what M1 is (UI shell, mock backends), prerequisites (Node 20+), `npm install`, `npm run dev`, `npm test`, `npm run dist` (scaffolded), the service-interface boundary and where real backends slot in (node-pty in `shell`, Vercel AI SDK in `agent`, better-sqlite3 in `store`), and the explicit M1 non-goals.

- [ ] **Step 2: Commit**

```bash
git add redcell && git commit -m "docs: README with run + architecture notes"
```

---

## Self-Review

**Spec coverage** (spec §5 screens → tasks): Home §5.1→T5; Workspace/Sidebar §5.2→T6; ChatPane/messages/tool cards/composer §5.2→T7; Context panel §5.3→T8; Terminal dock §5.4→T11; Modals + context menu §5.5→T9; Settings §5.6→T12. Behaviours §6: nav→T5/T6; create/rename/delete→T4/T9; send flow→T10; install→T10; terminal→T11; panel toggle→T8. Architecture §4: services+IPC→T2/T3/T10/T11; reducer→T4. Testing §8→T3/T4/T7/T10/T11/T13. Structure §9→file map above. Deferred §7 respected (no node-pty/AI-SDK/sqlite added). Success criteria §10: `npm run dev` on both OSes→T1/T13; visual match→T13; interactions via mocks→T5–T12; no direct service imports→enforced by `window.redcell.*` boundary throughout.

**Placeholder scan:** No "TBD/TODO/handle edge cases". UI-port tasks reference exact reference sections + give view-model code and full interfaces; logic/data/mock/theme tasks give complete code.

**Type consistency:** `Action` union in T4 extended in T5 (`seedActiveMap`) and T10 (agent-apply actions) — both call out the exact additions. `AgentEvent`/`Message`/`ShellRunResult` names match across T2/T10/T11. `buildSnapshot`/`getSnapshot`/`runSend`/`runInstall`/`runShell`/`shellTabs` names consistent between definition and consumption. Selector names (`activeChat`, `activeEngagement`, `engagementById`, `chatByIds`, `phaseLabel`, `statusColor`, `sevColor`, `monogram`) consistent T4→T5–T11.
