# Nexra M2 (Real Terminals) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mock `ShellService` with real interactive PTYs (`node-pty`) so the terminal dock runs live PowerShell / cmd / WSL-Kali (Windows) and the login shell / pwsh (macOS), with session buffers that survive dock close/reopen and processes that are killed on app quit.

**Architecture:** A main-process session registry (`electron/services/shell.pty.ts`) owns one real `node-pty` process per shell tab, created lazily and keyed by `ShellId` (so re-opening the dock re-attaches to the same running process instead of spawning a new one). Each session keeps a bounded in-memory scrollback ring buffer. The renderer's `TerminalDock` swaps its line-renderer + `<input>` for `@xterm/xterm` + `@xterm/addon-fit`, wired to the main process over a session/stream IPC API (`window.nexra.shell.{tabs,create,write,resize,kill,onData}`) instead of the old request/response `run`/`prompt` pair. Shell *availability* (which tabs exist) and shell *command resolution* (which binary to spawn) are pure, dependency-injected functions so they're unit-testable without spawning real processes; only the PTY registry itself is covered by a real-process integration test.

**Tech Stack:** `node-pty` (native, N-API/`node-addon-api` — ships prebuilt binaries for darwin-arm64/x64 and win32-x64/arm64, confirmed by inspecting the published 1.1.0 tarball; no `electron-rebuild`/ABI-rebuild step is needed because N-API binaries are ABI-stable across the Node version bundled in Electron and the system Node used by Vitest), `@xterm/xterm` + `@xterm/addon-fit` (renderer terminal emulator), Vitest for pure-logic + real-pty integration tests.

## Global Constraints

- Platforms: macOS (arm64 + x64) and Windows (x64/arm64) — both must resolve real shells; unavailable shells are omitted from `tabs()`, never shown broken.
- No per-command approval UI — execution stays ungated (locked decision, unchanged from M1).
- The agent does not drive the shell yet (M3). The "Shared with agent" pill in `TerminalDock` stays purely visual.
- Scrollback is in-memory only, capped (a few MB per session) — no disk persistence in M2.
- Dock chrome (resize handle, tab bar, "Shared with agent" pill, close button, exact colors from `theme.ts`) is preserved verbatim — only the scroll-area internals (line renderer + `<input>`) are replaced by the xterm mount. Per `CLAUDE.md`'s styling-fidelity rule, do not adjust any existing hex/px/rgba value while doing this.
- `node-pty` must be added as a runtime `dependency` (used in `electron/main.ts`'s process) and externalized in `vite.config.ts`'s electron build (`rollupOptions.external`) so esbuild doesn't try to bundle its native-binary loader.
- Closing the terminal dock (`closeTerminal` action) must keep hiding the UI only — it must **not** kill the underlying pty session (spec requirement: sessions outlive dock visibility, are only killed on app quit or explicit kill).

---

## File Structure

```
nexra/
  package.json                          # + node-pty, @xterm/xterm, @xterm/addon-fit
  vite.config.ts                         # externalize node-pty from the electron main bundle
  electron/
    main.ts                              # IPC wiring: shell:tabs/create/write/resize/kill, before-quit reap
    preload.ts                           # window.nexra.shell: tabs/create/write/resize/kill/onData
    services/
      shell.types.ts                     # ShellId (+'shell'), ShellTab, ShellCreateResult
      shell.resolve.ts                   # NEW — pure: resolveShellTabs, resolveShellCommand
      shell.probe.ts                     # NEW — real (impure) probe: which/wsl -l -q
      shell.pty.ts                       # NEW — session registry: create/write/resize/kill/killAll
      scrollback.ts                      # NEW — bounded ring-buffer for pty scrollback
      seed.ts                            # remove terminalShells / buildTerminalSessions (dead after cutover)
  src/
    global.d.ts                          # NexraApi.shell: new session/stream surface
    state/
      types.ts                           # terminalShell: ShellId; drop terminalInput
      reducer.ts                         # drop setTerminalInput action + initial field
    components/
      TerminalDock.tsx                   # xterm.js + FitAddon rewrite
  test/
    shell.pty.native.test.ts              # NEW — spike: real node-pty spawn/echo, proves no rebuild needed
    shell.resolve.test.ts                 # NEW — pure resolution logic
    scrollback.test.ts                    # NEW — ring buffer cap + replay order
    shell.pty.test.ts                     # NEW — real-process integration: create/write/resize/kill
    TerminalDock.test.tsx                 # rewritten — mocked xterm, asserts wiring not rendering
    shell.mock.test.ts                    # DELETE (mock removed)
```

---

### Task 1: Add `node-pty` and prove it runs with zero native rebuild

**Files:**
- Modify: `nexra/package.json`
- Test: `nexra/test/shell.pty.native.test.ts`

**Interfaces:**
- Produces: proof (via a real Vitest test, run the same way CI will run it) that `require('node-pty')`'s prebuilt N-API binary loads and spawns correctly under the plain Node process Vitest uses — the same guarantee that lets it also load, unmodified, inside Electron's main process (both are N-API host runtimes). This de-risks the rest of the milestone before any service/UI code is written.

- [ ] **Step 1: Add the dependency**

Edit `nexra/package.json`, add to `"dependencies"` (alongside `react`/`react-dom`):

```json
    "node-pty": "^1.1.0"
```

Run: `cd nexra && npm install`
Expected: installs cleanly; `node_modules/node-pty/prebuilds/` contains a subdirectory matching your OS/arch (e.g. `darwin-arm64` or `win32-x64`) — confirms a prebuilt binary was used, not a from-source native build.

- [ ] **Step 2: Write the spike test**

```ts
// test/shell.pty.native.test.ts
import { describe, it, expect } from 'vitest'
import * as pty from 'node-pty'
import os from 'node:os'

describe('node-pty native module', () => {
  it('spawns a real shell and echoes output without requiring a native rebuild', async () => {
    const isWin = process.platform === 'win32'
    const proc = pty.spawn(isWin ? 'cmd.exe' : (process.env.SHELL || '/bin/zsh'), isWin ? [] : ['-l'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: os.homedir(),
      env: process.env as Record<string, string>,
    })

    const output = await new Promise<string>((resolve, reject) => {
      let buf = ''
      const timeout = setTimeout(() => reject(new Error('timed out waiting for pty output: ' + buf)), 8000)
      proc.onData(data => {
        buf += data
        if (buf.includes('NEXRA_PTY_OK')) { clearTimeout(timeout); resolve(buf) }
      })
      proc.write('echo NEXRA_PTY_OK\r')
    })

    expect(output).toContain('NEXRA_PTY_OK')
    proc.kill()
  }, 10000)
})
```

- [ ] **Step 3: Run it**

Run: `cd nexra && npx vitest run test/shell.pty.native.test.ts`
Expected: PASS in well under 10s, with no native-binding load error (a load error would look like `Error: Cannot find module '.../pty.node'` or an ABI-version mismatch error — if you see either, stop and report it rather than reaching for `electron-rebuild`, since the whole point of this spike is that N-API prebuilds shouldn't need one).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json test/shell.pty.native.test.ts
git commit -m "spike: prove node-pty's N-API prebuilds work without an Electron rebuild step"
```

---

### Task 2: Pure shell resolution (which tabs exist, which binary to spawn)

**Files:**
- Create: `nexra/electron/services/shell.resolve.ts`, `nexra/electron/services/shell.probe.ts`
- Test: `nexra/test/shell.resolve.test.ts`

**Interfaces:**
- Consumes: `ShellId` from `shell.types.ts` (unchanged in this task — `'pwsh' | 'cmd' | 'kali'` for now; Task 4 adds `'shell'`, but this task's tests already exercise a `'shell'` variant since that's the whole point of the macOS case — go ahead and widen the type now since it's a one-line change with no other consumers yet: `export type ShellId = 'pwsh' | 'cmd' | 'kali' | 'shell'` in `shell.types.ts`).
- Produces: `resolveShellTabs(platform: NodeJS.Platform, probe: ShellProbe): ShellTab[]`, `resolveShellCommand(shell: ShellId, platform: NodeJS.Platform, env: Record<string, string | undefined>): { command: string; args: string[] }`, `ShellProbe` interface (`hasPwsh(): boolean`, `hasWslKali(): boolean`), and `createRealShellProbe(): ShellProbe` (impure, uses `which`/`wsl.exe -l -q` — not unit tested, since it's just OS process probing with nothing pure left to assert).

- [ ] **Step 1: Widen `ShellId` in `shell.types.ts`**

Change line 1 of `electron/services/shell.types.ts` from:
```ts
export type ShellId = 'pwsh' | 'cmd' | 'kali'
```
to:
```ts
export type ShellId = 'pwsh' | 'cmd' | 'kali' | 'shell'
```

- [ ] **Step 2: Write the failing test**

```ts
// test/shell.resolve.test.ts
import { describe, it, expect } from 'vitest'
import { resolveShellTabs, resolveShellCommand } from '../electron/services/shell.resolve'

const probe = (overrides: Partial<{ hasPwsh: boolean; hasWslKali: boolean }> = {}) => ({
  hasPwsh: () => overrides.hasPwsh ?? false,
  hasWslKali: () => overrides.hasWslKali ?? false,
})

describe('resolveShellTabs', () => {
  it('windows always shows PowerShell + Command Prompt', () => {
    const tabs = resolveShellTabs('win32', probe())
    expect(tabs.map(t => t.id)).toEqual(['pwsh', 'cmd'])
  })
  it('windows adds the Kali tab only when a kali-linux WSL distro is installed', () => {
    const tabs = resolveShellTabs('win32', probe({ hasWslKali: true }))
    expect(tabs.map(t => t.id)).toEqual(['pwsh', 'cmd', 'kali'])
  })
  it('macOS shows the login shell tab, and omits PowerShell unless pwsh is installed', () => {
    expect(resolveShellTabs('darwin', probe()).map(t => t.id)).toEqual(['shell'])
    expect(resolveShellTabs('darwin', probe({ hasPwsh: true })).map(t => t.id)).toEqual(['pwsh', 'shell'])
  })
})

describe('resolveShellCommand', () => {
  it('resolves windows shells to their native executables', () => {
    expect(resolveShellCommand('pwsh', 'win32', {})).toEqual({ command: 'powershell.exe', args: [] })
    expect(resolveShellCommand('cmd', 'win32', {})).toEqual({ command: 'cmd.exe', args: [] })
    expect(resolveShellCommand('kali', 'win32', {})).toEqual({ command: 'wsl.exe', args: ['-d', 'kali-linux'] })
  })
  it('resolves the macOS login shell from $SHELL, defaulting to zsh', () => {
    expect(resolveShellCommand('shell', 'darwin', {})).toEqual({ command: '/bin/zsh', args: ['-l'] })
    expect(resolveShellCommand('shell', 'darwin', { SHELL: '/bin/bash' })).toEqual({ command: '/bin/bash', args: ['-l'] })
  })
  it('resolves pwsh on macOS to the pwsh binary', () => {
    expect(resolveShellCommand('pwsh', 'darwin', {})).toEqual({ command: 'pwsh', args: [] })
  })
  it('throws for a shell/platform combination that is never offered', () => {
    expect(() => resolveShellCommand('cmd', 'darwin', {})).toThrow()
    expect(() => resolveShellCommand('kali', 'darwin', {})).toThrow()
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd nexra && npx vitest run test/shell.resolve.test.ts`
Expected: FAIL — `Cannot find module '../electron/services/shell.resolve'`.

- [ ] **Step 4: Implement `shell.resolve.ts`**

```ts
// electron/services/shell.resolve.ts
import type { ShellId, ShellTab } from './shell.types'

export interface ShellProbe {
  hasPwsh(): boolean
  hasWslKali(): boolean
}

export function resolveShellTabs(platform: NodeJS.Platform, probe: ShellProbe): ShellTab[] {
  if (platform === 'win32') {
    const tabs: ShellTab[] = [
      { id: 'pwsh', label: 'PowerShell', color: '#9aa2f5' },
      { id: 'cmd', label: 'Command Prompt', color: '#c9cdd4' },
    ]
    if (probe.hasWslKali()) tabs.push({ id: 'kali', label: 'Kali · WSL', color: '#5bd493' })
    return tabs
  }
  const tabs: ShellTab[] = []
  if (probe.hasPwsh()) tabs.push({ id: 'pwsh', label: 'PowerShell', color: '#9aa2f5' })
  tabs.push({ id: 'shell', label: 'Shell', color: '#5bd493' })
  return tabs
}

export function resolveShellCommand(
  shell: ShellId,
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
): { command: string; args: string[] } {
  if (platform === 'win32') {
    if (shell === 'pwsh') return { command: 'powershell.exe', args: [] }
    if (shell === 'cmd') return { command: 'cmd.exe', args: [] }
    if (shell === 'kali') return { command: 'wsl.exe', args: ['-d', 'kali-linux'] }
    throw new Error(`shell "${shell}" is not offered on win32`)
  }
  if (shell === 'pwsh') return { command: 'pwsh', args: [] }
  if (shell === 'shell') return { command: env.SHELL || '/bin/zsh', args: ['-l'] }
  throw new Error(`shell "${shell}" is not offered on ${platform}`)
}
```

- [ ] **Step 5: Implement the real probe**

```ts
// electron/services/shell.probe.ts
import { execFileSync } from 'node:child_process'
import type { ShellProbe } from './shell.resolve'

export function createRealShellProbe(): ShellProbe {
  return {
    hasPwsh() {
      try { execFileSync('which', ['pwsh'], { stdio: 'ignore' }); return true }
      catch { return false }
    },
    hasWslKali() {
      try {
        const out = execFileSync('wsl.exe', ['-l', '-q'], { encoding: 'utf16le' })
        return out.includes('kali-linux')
      } catch { return false }
    },
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd nexra && npx vitest run test/shell.resolve.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 7: Commit**

```bash
git add electron/services/shell.resolve.ts electron/services/shell.probe.ts electron/services/shell.types.ts test/shell.resolve.test.ts
git commit -m "feat: pure per-platform shell resolution (tabs + spawn command)"
```

---

### Task 3: Bounded scrollback ring buffer

**Files:**
- Create: `nexra/electron/services/scrollback.ts`
- Test: `nexra/test/scrollback.test.ts`

**Interfaces:**
- Produces: `class ScrollbackBuffer { constructor(capBytes?: number); push(data: string): void; read(): string }`.

- [ ] **Step 1: Write the failing test**

```ts
// test/scrollback.test.ts
import { describe, it, expect } from 'vitest'
import { ScrollbackBuffer } from '../electron/services/scrollback'

describe('ScrollbackBuffer', () => {
  it('replays pushed chunks in order', () => {
    const buf = new ScrollbackBuffer()
    buf.push('hello ')
    buf.push('world')
    expect(buf.read()).toBe('hello world')
  })

  it('evicts the oldest chunks once the byte cap is exceeded', () => {
    const buf = new ScrollbackBuffer(10)
    buf.push('0123456789') // exactly at cap, nothing evicted yet
    buf.push('abcde') // pushes total to 15 (>10) -> evicts the first chunk
    expect(buf.read()).toBe('abcde')
  })

  it('never evicts the last remaining chunk even if it alone exceeds the cap', () => {
    const buf = new ScrollbackBuffer(4)
    buf.push('this-single-chunk-is-longer-than-the-cap')
    expect(buf.read()).toBe('this-single-chunk-is-longer-than-the-cap')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nexra && npx vitest run test/scrollback.test.ts`
Expected: FAIL — `Cannot find module '../electron/services/scrollback'`.

- [ ] **Step 3: Implement `scrollback.ts`**

```ts
// electron/services/scrollback.ts
export class ScrollbackBuffer {
  private chunks: string[] = []
  private totalBytes = 0

  constructor(private readonly capBytes: number = 5 * 1024 * 1024) {}

  push(data: string): void {
    this.chunks.push(data)
    this.totalBytes += Buffer.byteLength(data, 'utf8')
    while (this.totalBytes > this.capBytes && this.chunks.length > 1) {
      const removed = this.chunks.shift()!
      this.totalBytes -= Buffer.byteLength(removed, 'utf8')
    }
  }

  read(): string {
    return this.chunks.join('')
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd nexra && npx vitest run test/scrollback.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add electron/services/scrollback.ts test/scrollback.test.ts
git commit -m "feat: bounded scrollback ring buffer for pty sessions"
```

---

### Task 4: PTY session registry (main-process service)

**Files:**
- Modify: `nexra/electron/services/shell.types.ts`
- Create: `nexra/electron/services/shell.pty.ts`
- Test: `nexra/test/shell.pty.test.ts`

**Interfaces:**
- Consumes: `resolveShellTabs`/`resolveShellCommand` (Task 2), `createRealShellProbe` (Task 2), `ScrollbackBuffer` (Task 3).
- Produces: `shellTabs(): ShellTab[]`; `createSession(shell: ShellId, cols: number, rows: number, onData: (data: string) => void): ShellCreateResult`; `writeToSession(sessionId: ShellId, data: string): void`; `resizeSession(sessionId: ShellId, cols: number, rows: number): void`; `killSession(sessionId: ShellId): void`; `killAllSessions(): void`; `getSessionPid(sessionId: ShellId): number | undefined` (test-only introspection hook, also useful for future diagnostics). **Design note:** the registry is keyed by `ShellId` itself (one dock, one session per shell type — "sessionId" and "ShellId" are the same value), which is what makes `create()` idempotent: calling it again for a shell that's already running just returns that session's current scrollback instead of spawning a second process. This satisfies the spec's "stable session id" requirement without inventing per-window/per-call UUID bookkeeping nothing else needs yet.

- [ ] **Step 1: Add `ShellCreateResult` to `shell.types.ts`**

Add to `electron/services/shell.types.ts` (leave the existing `ShellLine`/`ShellRunResult` types in place for now — the old mock still uses them until Task 7's cleanup):

```ts
export interface ShellCreateResult { sessionId: ShellId; scrollback: string }
```

- [ ] **Step 2: Write the failing integration test**

```ts
// test/shell.pty.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { createSession, writeToSession, resizeSession, killSession, getSessionPid } from '../electron/services/shell.pty'

// 'cmd' resolves on win32, 'shell' (the login-shell tab) resolves everywhere else —
// this lets the same test spawn a real process on both CI OSes.
const shell = process.platform === 'win32' ? 'cmd' : 'shell'

describe('shell.pty session registry (real node-pty)', () => {
  afterEach(() => { try { killSession(shell) } catch { /* already gone */ } })

  it('spawns a session, streams command output, resizes, and kills the process', async () => {
    const chunks: string[] = []
    const { sessionId, scrollback } = createSession(shell, 80, 24, data => chunks.push(data))
    expect(sessionId).toBe(shell)
    expect(scrollback).toBe('')

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timed out waiting for echoed output: ' + chunks.join(''))), 8000)
      const poll = setInterval(() => {
        if (chunks.join('').includes('NEXRA_ECHO_OK')) { clearTimeout(timeout); clearInterval(poll); resolve() }
      }, 50)
      writeToSession(sessionId, 'echo NEXRA_ECHO_OK\r')
    })

    expect(() => resizeSession(sessionId, 100, 40)).not.toThrow()

    const pid = getSessionPid(sessionId)!
    expect(typeof pid).toBe('number')
    killSession(sessionId)
    await new Promise(r => setTimeout(r, 200))
    expect(() => process.kill(pid, 0)).toThrow()
  }, 10000)

  it('create() is idempotent — a second call for a running shell returns the same session without respawning', () => {
    const first = createSession(shell, 80, 24, () => {})
    const pidBefore = getSessionPid(first.sessionId)
    const second = createSession(shell, 80, 24, () => {})
    expect(second.sessionId).toBe(first.sessionId)
    expect(getSessionPid(second.sessionId)).toBe(pidBefore)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd nexra && npx vitest run test/shell.pty.test.ts`
Expected: FAIL — `Cannot find module '../electron/services/shell.pty'`.

- [ ] **Step 4: Implement `shell.pty.ts`**

```ts
// electron/services/shell.pty.ts
import * as pty from 'node-pty'
import os from 'node:os'
import type { ShellId, ShellTab, ShellCreateResult } from './shell.types'
import { resolveShellTabs, resolveShellCommand } from './shell.resolve'
import { createRealShellProbe } from './shell.probe'
import { ScrollbackBuffer } from './scrollback'

interface PtyRecord { proc: pty.IPty; buffer: ScrollbackBuffer }

const sessions = new Map<ShellId, PtyRecord>()

export function shellTabs(): ShellTab[] {
  return resolveShellTabs(process.platform, createRealShellProbe())
}

export function createSession(
  shell: ShellId,
  cols: number,
  rows: number,
  onData: (data: string) => void,
): ShellCreateResult {
  const existing = sessions.get(shell)
  if (existing) return { sessionId: shell, scrollback: existing.buffer.read() }

  const { command, args } = resolveShellCommand(shell, process.platform, process.env)
  const proc = pty.spawn(command, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: os.homedir(),
    env: process.env as Record<string, string>,
  })
  const buffer = new ScrollbackBuffer()
  proc.onData(data => { buffer.push(data); onData(data) })
  proc.onExit(() => { sessions.delete(shell) })
  sessions.set(shell, { proc, buffer })
  return { sessionId: shell, scrollback: '' }
}

export function writeToSession(sessionId: ShellId, data: string): void {
  sessions.get(sessionId)?.proc.write(data)
}

export function resizeSession(sessionId: ShellId, cols: number, rows: number): void {
  sessions.get(sessionId)?.proc.resize(cols, rows)
}

export function killSession(sessionId: ShellId): void {
  sessions.get(sessionId)?.proc.kill()
  sessions.delete(sessionId)
}

export function killAllSessions(): void {
  sessions.forEach(r => r.proc.kill())
  sessions.clear()
}

export function getSessionPid(sessionId: ShellId): number | undefined {
  return sessions.get(sessionId)?.proc.pid
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd nexra && npx vitest run test/shell.pty.test.ts`
Expected: PASS, 2 tests. (On Windows this spawns real `cmd.exe`; on macOS/Linux CI it spawns the runner's login shell — both are always present, so this isn't gated/skipped on either CI OS.)

- [ ] **Step 6: Commit**

```bash
git add electron/services/shell.types.ts electron/services/shell.pty.ts test/shell.pty.test.ts
git commit -m "feat: real node-pty session registry (create/write/resize/kill, idempotent per shell)"
```

---

### Task 5: Wire the real shell service into main/preload (additive)

**Files:**
- Modify: `nexra/electron/main.ts`, `nexra/electron/preload.ts`, `nexra/src/global.d.ts`, `nexra/vite.config.ts`

**Interfaces:**
- Consumes: `shellTabs`, `createSession`, `writeToSession`, `resizeSession`, `killSession`, `killAllSessions` from `shell.pty.ts` (Task 4).
- Produces: `window.nexra.shell.{create,write,resize,kill,onData}` alongside the still-present `tabs`/`run`/`prompt` (removed in Task 7, once `TerminalDock` no longer needs them). This task is deliberately additive so nothing that currently compiles or passes breaks mid-milestone — `TerminalDock.test.tsx` stubs `window.nexra` directly in-memory and never goes through real IPC, so it's unaffected by any of these changes.

- [ ] **Step 1: Externalize `node-pty` in the electron build**

In `vite.config.ts`, change the `electron([...])` plugin's main entry from:
```ts
      { entry: 'electron/main.ts' },
```
to:
```ts
      { entry: 'electron/main.ts', vite: { build: { rollupOptions: { external: ['node-pty'] } } } },
```
(`node-pty` dynamically loads a platform-specific `.node` prebuild at require-time; bundling it with esbuild would break that lookup, so it must stay an external runtime `require` — the same reason it's a `dependency`, not bundled into the renderer.)

- [ ] **Step 2: Wire new IPC handlers in `main.ts`**

Change the imports at the top of `electron/main.ts` from:
```ts
import { runShell, shellTabs, shellPromptStored, inlinePrompt, shellColor } from './services/shell.mock'
```
to:
```ts
import { runShell, shellPromptStored, inlinePrompt, shellColor } from './services/shell.mock'
import { shellTabs, createSession, writeToSession, resizeSession, killSession, killAllSessions } from './services/shell.pty'
```

Change the `shell:tabs` handler registration from `() => shellTabs()` (the mock's, imported from `shell.mock`) to use the new import (same call shape, now backed by real platform resolution) — no code change needed at the call site since the name is unchanged, only the import source. Then add the new handlers right after it:

```ts
  ipcMain.handle('shell:create', (ev, { shell, cols, rows }: { shell: any; cols: number; rows: number }) =>
    createSession(shell, cols, rows, data => ev.sender.send('shell:data', { sessionId: shell, data })))
  ipcMain.handle('shell:write', (_e, { sessionId, data }: { sessionId: any; data: string }) => writeToSession(sessionId, data))
  ipcMain.handle('shell:resize', (_e, { sessionId, cols, rows }: { sessionId: any; cols: number; rows: number }) => resizeSession(sessionId, cols, rows))
  ipcMain.handle('shell:kill', (_e, sessionId: any) => killSession(sessionId))
```

Add, after the `app.on('window-all-closed', ...)` line at the bottom of the file:
```ts
app.on('before-quit', () => killAllSessions())
```

- [ ] **Step 3: Expose the new surface in `preload.ts`**

Replace the whole file with:

```ts
import { contextBridge, ipcRenderer } from 'electron'

const shellDataListeners = new Map<string, Set<(data: string) => void>>()
ipcRenderer.on('shell:data', (_e, payload: { sessionId: string; data: string }) => {
  shellDataListeners.get(payload.sessionId)?.forEach(cb => cb(payload.data))
})

contextBridge.exposeInMainWorld('nexra', {
  store: { snapshot: () => ipcRenderer.invoke('store:snapshot') },
  agent: {
    send: (req: any, onEvent: any) => { const ch = 'agent:event:' + req.chatId; const l = (_: any, e: any) => onEvent(e); ipcRenderer.on(ch, l); return ipcRenderer.invoke('agent:send', req).finally(() => ipcRenderer.removeListener(ch, l)) },
    install: (req: any, onEvent: any) => { const ch = 'agent:event:' + req.chatId; const l = (_: any, e: any) => onEvent(e); ipcRenderer.on(ch, l); return ipcRenderer.invoke('agent:install', req).finally(() => ipcRenderer.removeListener(ch, l)) },
  },
  shell: {
    tabs: () => ipcRenderer.invoke('shell:tabs'),
    run: (shell: any, raw: any) => ipcRenderer.invoke('shell:run', { shell, raw }),
    prompt: (shell: any) => ipcRenderer.invoke('shell:prompt', shell),
    create: (shell: any, cols: number, rows: number) => ipcRenderer.invoke('shell:create', { shell, cols, rows }),
    write: (sessionId: any, data: string) => ipcRenderer.invoke('shell:write', { sessionId, data }),
    resize: (sessionId: any, cols: number, rows: number) => ipcRenderer.invoke('shell:resize', { sessionId, cols, rows }),
    kill: (sessionId: any) => ipcRenderer.invoke('shell:kill', sessionId),
    onData: (sessionId: string, cb: (data: string) => void) => {
      if (!shellDataListeners.has(sessionId)) shellDataListeners.set(sessionId, new Set())
      shellDataListeners.get(sessionId)!.add(cb)
      return () => shellDataListeners.get(sessionId)?.delete(cb)
    },
  },
})
```

- [ ] **Step 4: Extend `NexraApi` in `global.d.ts`**

Replace the file with:

```ts
import type { Snapshot } from '../electron/services/store.types'
import type { AgentEvent, AgentSendRequest, AgentInstallRequest } from '../electron/services/agent.types'
import type { ShellId, ShellTab, ShellRunResult, ShellCreateResult } from '../electron/services/shell.types'

export interface NexraApi {
  store: { snapshot(): Promise<Snapshot> }
  agent: {
    send(req: AgentSendRequest, onEvent: (e: AgentEvent) => void): Promise<void>
    install(req: AgentInstallRequest, onEvent: (e: AgentEvent) => void): Promise<void>
  }
  shell: {
    tabs(): Promise<ShellTab[]>
    run(shell: ShellId, raw: string): Promise<ShellRunResult>
    prompt(shell: ShellId): Promise<{ stored: string; inline: string; color: string }>
    create(shell: ShellId, cols: number, rows: number): Promise<ShellCreateResult>
    write(sessionId: ShellId, data: string): Promise<void>
    resize(sessionId: ShellId, cols: number, rows: number): Promise<void>
    kill(sessionId: ShellId): Promise<void>
    onData(sessionId: ShellId, cb: (data: string) => void): () => void
  }
}
declare global { interface Window { nexra: NexraApi } }
```

- [ ] **Step 5: Verify nothing broke**

Run: `cd nexra && npx tsc --noEmit && npm test`
Expected: `tsc` clean; all existing suites still pass (this task adds surface, it doesn't remove anything `TerminalDock.tsx` still depends on).

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts electron/preload.ts src/global.d.ts vite.config.ts
git commit -m "feat: wire real pty session IPC (create/write/resize/kill/onData) alongside the mock"
```

---

### Task 6: `TerminalDock.tsx` — xterm.js rewrite

**Files:**
- Modify: `nexra/package.json` (add `@xterm/xterm`, `@xterm/addon-fit`)
- Modify: `nexra/src/components/TerminalDock.tsx`
- Test: `nexra/test/TerminalDock.test.tsx` (rewritten)

**Interfaces:**
- Consumes: `window.nexra.shell.{tabs,create,write,resize,kill,onData}` (Task 5).
- Produces: the same `TerminalDock({ state, dispatch })` component signature — no change to how `Workspace.tsx` mounts it.

- [ ] **Step 1: Add xterm dependencies**

Edit `nexra/package.json`, add to `"dependencies"`:

```json
    "@xterm/addon-fit": "^0.11.0",
    "@xterm/xterm": "^6.0.0",
```

Run: `cd nexra && npm install`

- [ ] **Step 2: Rewrite `TerminalDock.tsx`**

Replace the whole file:

```tsx
import type { Dispatch } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { AppState } from '../state/selectors'
import type { Action } from '../state/reducer'
import type { ShellId, ShellTab } from '../../electron/services/shell.types'
import { theme } from '../theme'

export function TerminalDock({ state, dispatch }: { state: AppState; dispatch: Dispatch<Action> }) {
  const shell = state.ui.terminalShell
  const [tabs, setTabs] = useState<ShellTab[]>([])

  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const writeRef = useRef<(data: string) => void>(() => {})
  const sessionIdRef = useRef<ShellId | null>(null)

  const resizing = useRef(false)
  const startY = useRef(0)
  const startH = useRef(state.ui.terminalHeight)

  useEffect(() => {
    window.nexra.shell.tabs().then(ts => {
      setTabs(ts)
      if (ts.length && !ts.some(t => t.id === shell)) dispatch({ t: 'setTerminalShell', id: ts[0].id })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mounts once: TerminalDock only exists in the DOM while the dock is open
  // (see Workspace.tsx's `{ui.terminalOpen && <TerminalDock .../>}`), so this
  // effect's lifetime is exactly "dock is open".
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const term = new Terminal({
      fontFamily: theme.mono, fontSize: 12.5, lineHeight: 1.4, cursorBlink: true,
      theme: { background: theme.term, foreground: theme.text, cursor: theme.ok2, selectionBackground: 'rgba(111,123,240,0.35)' },
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(el)
    fitAddon.fit()
    term.onData(data => writeRef.current(data))
    termRef.current = term
    fitAddonRef.current = fitAddon
    return () => {
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
    }
  }, [])

  // Attach/detach xterm to the session for the active tab. Sessions live in the
  // main process and outlive this component (docs/superpowers/specs/2026-07-01-redcell-m0-m2-design.md,
  // "Buffer persistence") — this only re-points the local view at whichever
  // session is active, replaying its scrollback and subscribing to live output.
  useEffect(() => {
    const term = termRef.current
    const fitAddon = fitAddonRef.current
    if (!term || !fitAddon) return
    let cancelled = false
    let unsubscribe: (() => void) | null = null

    fitAddon.fit()
    window.nexra.shell.create(shell, term.cols, term.rows).then(({ sessionId, scrollback }) => {
      if (cancelled) return
      sessionIdRef.current = sessionId
      writeRef.current = data => window.nexra.shell.write(sessionId, data)
      term.reset()
      term.write(scrollback)
      unsubscribe = window.nexra.shell.onData(sessionId, data => term.write(data))
    })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [shell])

  // Refit + propagate size on dock resize (drag handle) ...
  useEffect(() => {
    const term = termRef.current
    const fitAddon = fitAddonRef.current
    const sessionId = sessionIdRef.current
    if (!term || !fitAddon || !sessionId) return
    fitAddon.fit()
    window.nexra.shell.resize(sessionId, term.cols, term.rows)
  }, [state.ui.terminalHeight])

  // ...and on window resize.
  useEffect(() => {
    const onResize = () => {
      const term = termRef.current
      const fitAddon = fitAddonRef.current
      const sessionId = sessionIdRef.current
      if (!term || !fitAddon || !sessionId) return
      fitAddon.fit()
      window.nexra.shell.resize(sessionId, term.cols, term.rows)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizing.current) return
      const dy = startY.current - e.clientY
      let h = startH.current + dy
      const max = Math.max(200, window.innerHeight - 120)
      h = Math.max(160, Math.min(max, h))
      dispatch({ t: 'setTerminalHeight', h })
    }
    const onUp = () => { if (resizing.current) { resizing.current = false; document.body.style.userSelect = '' } }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dispatch])

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    resizing.current = true
    startY.current = e.clientY
    startH.current = state.ui.terminalHeight
    document.body.style.userSelect = 'none'
  }

  const closeTerminal = () => dispatch({ t: 'closeTerminal' })
  const setTerminalShell = (id: ShellId) => dispatch({ t: 'setTerminalShell', id })
  const focusTerm = () => termRef.current?.focus()

  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, height: state.ui.terminalHeight + 'px', zIndex: 70, display: 'flex', flexDirection: 'column', background: theme.term, borderTop: '1px solid rgba(255,255,255,0.13)', boxShadow: '0 -20px 60px rgba(0,0,0,0.6)' }}>

      <div onMouseDown={startResize} style={{ flex: 'none', height: 8, cursor: 'ns-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', background: theme.panel, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <span style={{ width: 40, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.2)' }} />
      </div>

      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', background: theme.panel, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span style={{ fontFamily: theme.mono, fontSize: 12, color: theme.ok2, letterSpacing: '-1px', marginRight: 5 }}>{'›_'}</span>
        {tabs.map(t => {
          const active = t.id === shell
          return (
            <button
              key={t.id}
              onClick={() => setTerminalShell(t.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 13px', borderRadius: 8, border: '1px solid transparent', background: active ? theme.term : 'transparent', color: active ? theme.text : theme.muted, fontFamily: 'inherit', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.color }} />
              {t.label}
            </button>
          )
        })}
        <div style={{ flex: 1 }} />
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: theme.muted2, padding: '3px 10px', borderRadius: 20, background: 'rgba(111,123,240,0.1)', border: '1px solid rgba(111,123,240,0.22)' }}>
          <span style={{ color: theme.accentSoft, fontSize: 9 }}>{'◆'}</span> Shared with agent
        </span>
        <button
          onClick={closeTerminal}
          title="Close terminal"
          onMouseEnter={e => { e.currentTarget.style.color = theme.textDim; e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#7d838c'; e.currentTarget.style.background = 'transparent' }}
          style={{ width: 26, height: 26, borderRadius: 7, border: 'none', background: 'transparent', color: '#7d838c', fontSize: 13, cursor: 'pointer', transition: 'all .12s' }}
        >
          {'✕'}
        </button>
      </div>

      <div ref={containerRef} onClick={focusTerm} style={{ flex: 1, minHeight: 0, padding: '12px 15px 16px', background: theme.term, cursor: 'text' }} />
    </div>
  )
}
```

- [ ] **Step 3: Rewrite the test** (mock `@xterm/xterm`/`@xterm/addon-fit` — per the design spec, "the xterm renderer itself is hard to unit-test meaningfully"; this test asserts the *wiring* — session created for the right shell/size, scrollback written, keystrokes forwarded, tab switch re-attaches — not pixel rendering, which jsdom can't do for a canvas-adjacent library anyway)

```tsx
// test/TerminalDock.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TerminalDock } from '../src/components/TerminalDock'

const fakeTerm = {
  cols: 80, rows: 24,
  loadAddon: vi.fn(),
  open: vi.fn(),
  onData: vi.fn(),
  write: vi.fn(),
  reset: vi.fn(),
  focus: vi.fn(),
  dispose: vi.fn(),
}

vi.mock('@xterm/xterm', () => ({ Terminal: vi.fn(() => fakeTerm) }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: vi.fn(() => ({ fit: vi.fn() })) }))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

function Harness() {
  const [ui, setUi] = useState<any>({ terminalOpen: true, terminalShell: 'pwsh', terminalHeight: 346 })
  const dispatch = (action: any) => {
    setUi((prev: any) => {
      switch (action.t) {
        case 'setTerminalShell': return { ...prev, terminalShell: action.id }
        case 'setTerminalHeight': return { ...prev, terminalHeight: action.h }
        case 'closeTerminal': return { ...prev, terminalOpen: false }
        default: return prev
      }
    })
  }
  return <TerminalDock state={{ ui } as any} dispatch={dispatch} />
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as any).nexra = {
    shell: {
      tabs: vi.fn(async () => [
        { id: 'pwsh', label: 'PowerShell', color: '#9aa2f5' },
        { id: 'cmd', label: 'Command Prompt', color: '#c9cdd4' },
      ]),
      create: vi.fn(async (s: string) => ({ sessionId: s, scrollback: 'PS C:\\Users\\pentester> ' })),
      write: vi.fn(async () => {}),
      resize: vi.fn(async () => {}),
      kill: vi.fn(async () => {}),
      onData: vi.fn(() => () => {}),
    },
  }
})

describe('TerminalDock', () => {
  it('creates a session for the active tab and replays its scrollback into xterm', async () => {
    render(<Harness />)
    await screen.findByText('PowerShell')
    await waitFor(() => expect((window as any).nexra.shell.create).toHaveBeenCalledWith('pwsh', 80, 24))
    await waitFor(() => expect(fakeTerm.write).toHaveBeenCalledWith('PS C:\\Users\\pentester> '))
    expect((window as any).nexra.shell.onData).toHaveBeenCalledWith('pwsh', expect.any(Function))
  })

  it('forwards keystrokes from xterm straight to the pty session', async () => {
    render(<Harness />)
    await waitFor(() => expect((window as any).nexra.shell.create).toHaveBeenCalled())
    const onDataHandler = fakeTerm.onData.mock.calls[0][0]
    onDataHandler('ls\r')
    await waitFor(() => expect((window as any).nexra.shell.write).toHaveBeenCalledWith('pwsh', 'ls\r'))
  })

  it('switches tabs on click, attaching xterm to the newly selected shell', async () => {
    render(<Harness />)
    await waitFor(() => expect((window as any).nexra.shell.create).toHaveBeenCalledWith('pwsh', 80, 24))
    fireEvent.click(screen.getByText('Command Prompt'))
    await waitFor(() => expect((window as any).nexra.shell.create).toHaveBeenCalledWith('cmd', 80, 24))
  })
})
```

- [ ] **Step 4: Run the tests**

Run: `cd nexra && npx vitest run test/TerminalDock.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/components/TerminalDock.tsx test/TerminalDock.test.tsx
git commit -m "feat: TerminalDock renders real pty sessions via xterm.js + FitAddon"
```

---

### Task 7: Remove the mock and dead code

**Files:**
- Modify: `nexra/electron/services/shell.types.ts`, `nexra/electron/main.ts`, `nexra/electron/preload.ts`, `nexra/src/global.d.ts`, `nexra/electron/services/seed.ts`, `nexra/src/state/types.ts`, `nexra/src/state/reducer.ts`
- Delete: `nexra/electron/services/shell.mock.ts`, `nexra/test/shell.mock.test.ts`

**Interfaces:**
- Produces: no functional change from Task 6's end state — this task only deletes now-unreachable code so the codebase doesn't carry two shell implementations side by side.

- [ ] **Step 1: Trim `shell.types.ts`**

Remove the now-unused line-model types, leaving only:

```ts
export type ShellId = 'pwsh' | 'cmd' | 'kali' | 'shell'
export interface ShellTab { id: ShellId; label: string; color: string }
export interface ShellCreateResult { sessionId: ShellId; scrollback: string }
```

(This deletes `ShellLine` and `ShellRunResult`.)

- [ ] **Step 2: Delete the mock and its test**

```bash
git rm nexra/electron/services/shell.mock.ts nexra/test/shell.mock.test.ts
```

- [ ] **Step 3: Remove the mock-backed handlers from `main.ts`**

Change the imports from:
```ts
import { runShell, shellPromptStored, inlinePrompt, shellColor } from './services/shell.mock'
import { shellTabs, createSession, writeToSession, resizeSession, killSession, killAllSessions } from './services/shell.pty'
```
to:
```ts
import { shellTabs, createSession, writeToSession, resizeSession, killSession, killAllSessions } from './services/shell.pty'
```

Remove these two handler registrations:
```ts
  ipcMain.handle('shell:run', (_e, { shell, raw }) => runShell(shell, raw))
  ipcMain.handle('shell:prompt', (_e, shell) => ({ stored: shellPromptStored(shell), inline: inlinePrompt(shell), color: shellColor(shell) }))
```

- [ ] **Step 4: Remove `run`/`prompt` from `preload.ts`**

Remove these two lines from the `shell` object:
```ts
    run: (shell: any, raw: any) => ipcRenderer.invoke('shell:run', { shell, raw }),
    prompt: (shell: any) => ipcRenderer.invoke('shell:prompt', shell),
```

- [ ] **Step 5: Remove `run`/`prompt` from `global.d.ts`**

Change the import line from:
```ts
import type { ShellId, ShellTab, ShellRunResult, ShellCreateResult } from '../electron/services/shell.types'
```
to:
```ts
import type { ShellId, ShellTab, ShellCreateResult } from '../electron/services/shell.types'
```

Remove these two lines from `NexraApi.shell`:
```ts
    run(shell: ShellId, raw: string): Promise<ShellRunResult>
    prompt(shell: ShellId): Promise<{ stored: string; inline: string; color: string }>
```

- [ ] **Step 6: Remove dead demo data from `seed.ts`**

Delete the `terminalShells` array (lines 15–19) and the `buildTerminalSessions` function (lines 129–144) from `electron/services/seed.ts` — nothing imports either anymore.

- [ ] **Step 7: Drop `terminalInput` from UI state**

In `src/state/types.ts`, change:
```ts
  terminalOpen: boolean; terminalShell: 'pwsh' | 'cmd' | 'kali'; terminalHeight: number; terminalInput: string
```
to (add the import at the top of the file too: `import type { ShellId } from '../../electron/services/shell.types'`):
```ts
  terminalOpen: boolean; terminalShell: ShellId; terminalHeight: number
```

In `src/state/reducer.ts`, change the initial-state line:
```ts
  terminalOpen: false, terminalShell: 'pwsh', terminalHeight: 346, terminalInput: '',
```
to:
```ts
  terminalOpen: false, terminalShell: 'pwsh', terminalHeight: 346,
```

Change the `Action` union line:
```ts
  | { t: 'toggleTerminal' } | { t: 'closeTerminal' } | { t: 'setTerminalShell'; id: UIState['terminalShell'] } | { t: 'setTerminalInput'; value: string } | { t: 'setTerminalHeight'; h: number }
```
to:
```ts
  | { t: 'toggleTerminal' } | { t: 'closeTerminal' } | { t: 'setTerminalShell'; id: UIState['terminalShell'] } | { t: 'setTerminalHeight'; h: number }
```

Remove the reducer case:
```ts
    case 'setTerminalInput': U.terminalInput = a.value; return s
```

- [ ] **Step 8: Confirm no stragglers, then run everything**

Run: `cd nexra && grep -rn "terminalInput\|ShellLine\|ShellRunResult\|shell\.mock\|buildTerminalSessions\|terminalShells" --include="*.ts" --include="*.tsx" . | grep -v node_modules`
Expected: no output.

Run: `cd nexra && npx tsc --noEmit && npm test && npm run build`
Expected: all clean; full Vitest suite passes (existing store/reducer/agent/ToolCard suites untouched, plus the six new/rewritten M2 suites from Tasks 1–6).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: remove mock ShellService and terminalInput now that real ptys are wired"
```

---

### Task 8: Cross-platform dogfood check + docs

**Files:**
- Modify: `docs/superpowers/HANDOVER.md`, `CLAUDE.md`

**Interfaces:**
- Produces: an updated handover reflecting M2's completion, for the next milestone (M3, agent-driven shell) to pick up from.

- [ ] **Step 1: Manual dogfood (skip gracefully if no display is available in your environment — note that explicitly rather than skipping silently)**

Run: `cd nexra && npm run dev`
Walk through, on whichever OS you have available:
- Open the dock (`` Ctrl+` ``); confirm the active tab's real shell prompt appears (not a fabricated one).
- Run `ls`/`dir`, `whoami` — confirm real output.
- Start a long-running command (e.g. `ping 8.8.8.8` or `sleep 30`), close the dock, reopen it — confirm the command is still running and scrollback repainted.
- Switch tabs — confirm each tab attaches to its own independent session.
- Drag-resize the dock — confirm the terminal reflows without visual glitches.
- Quit the app; confirm (`ps aux | grep -i pty` on macOS, Task Manager on Windows) no orphaned shell/pty processes remain.

If both platforms aren't available to you, note in the commit message which OS was actually exercised, and flag the other as pending manual verification before the branch is considered fully done (per the spec's M2 acceptance criteria, both are required before ship — this plan can't force that if the hardware isn't at hand).

- [ ] **Step 2: Update `docs/superpowers/HANDOVER.md`**

Update the "Status" line at the top to: `M1 (UI shell) + M2 (real terminals) complete, reviewed, merged to master.`

In "Known limitations / deferred to M2 (not blocking, all triaged)", remove the two bullets this milestone resolved:
- `**Real backends not yet wired:** node-pty in ShellService, ...` — narrow this bullet to just the two still-mocked backends: `**Real backends still mocked:** Vercel AI SDK + Claude in AgentService (provider-agnostic, ungated execution), better-sqlite3 in StoreService.`
- `**Terminal dock buffers reset** when the dock is closed/reopened ...` — delete this bullet entirely (fixed: sessions now live in the main process and survive dock close/reopen).

Add a new "What was built (M2)" section (mirroring the existing "What was built (M1)" section) summarizing: real `node-pty` sessions keyed by `ShellId`, N-API prebuilds requiring no Electron rebuild step, bounded in-memory scrollback, `xterm.js`+`FitAddon` renderer, platform-resolved shell tabs (macOS: login shell + optional pwsh; Windows: PowerShell + cmd + optional WSL-Kali), all sessions killed on `before-quit`.

Add a note under "Next step": M3 is the agent driving the shell (the "Shared with agent" pill goes from visual-only to real), plus `better-sqlite3` persistence and the live Claude/AI-SDK agent — spec and plan those just-in-time per the existing process.

- [ ] **Step 3: Update `CLAUDE.md`**

Update the "Status" section: change `**M1 (UI shell) complete** and merged to master.` to reflect M1+M2 complete, update the test count (run `cd nexra && npm test 2>&1 | tail -5` to get the current passing count and use it), and update the bullet `mock backends only (no real execution, no live LLM, no persistence)` to `real terminals (node-pty), mock agent + store backends (no live LLM, no persistence)`.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/HANDOVER.md CLAUDE.md
git commit -m "docs: M2 (real terminals) handover + status update"
```

---

## Self-Review

**Spec coverage** (`docs/superpowers/specs/2026-07-01-redcell-m0-m2-design.md`, M2 section): "not a zero-UI-change swap" / new service interface → Task 5 (IPC) + Task 6 (`TerminalDock`); shell resolution per platform → Task 2; buffer persistence across dock close/reopen → Task 4's idempotent `createSession` + Task 6's scrollback replay on attach; session lifecycle (lazy create, kill on quit, no orphaned ptys) → Task 4 (`killAllSessions`) + Task 5 (`before-quit`) + Task 8 (dogfood verifies no orphans); renderer changes (xterm.js, FitAddon, preserved chrome) → Task 6; native dependency handling / spike → Task 1; testing (pure resolution, ring buffer, real-pty integration, xterm covered by dogfood not brittle DOM assertions) → Tasks 2/3/4/6/8; M2 acceptance criteria → Task 8. Explicitly-out-of-scope items (agent driving the shell, disk-persisted scrollback, per-command approval) are not touched by any task.

**Placeholder scan:** no TBD/TODO/"handle edge cases" language; every step with a code change shows the complete code, not a description of it; every "run the test" step states the exact command and expected result.

**Type consistency:** `ShellId` widened to include `'shell'` in Task 2 and consumed identically in Tasks 4–7 (`shell.pty.ts`, `TerminalDock.tsx`, `state/types.ts`). `ShellCreateResult { sessionId, scrollback }` introduced in Task 4, consumed identically in Task 5 (`global.d.ts`), Task 6 (`TerminalDock.tsx`'s `.then(({ sessionId, scrollback }) => ...)`). `resolveShellTabs`/`resolveShellCommand` signatures defined in Task 2 match their only caller (`shell.pty.ts`) in Task 4. `window.nexra.shell.{create,write,resize,kill,onData}` names are identical across Task 5 (preload + global.d.ts) and Task 6 (`TerminalDock.tsx` calls) and Task 6's test (mocked with the same names). Task 7 removes `ShellLine`/`ShellRunResult`/`run`/`prompt`/`terminalInput` only after confirming (grep) they have no remaining references.
