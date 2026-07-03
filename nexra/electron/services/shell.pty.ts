import * as pty from 'node-pty'
import os from 'node:os'
import type { ShellId, ShellTab, ShellCreateResult } from './shell.types'
import { resolveShellTabs, resolveShellCommand } from './shell.resolve'
import { createRealShellProbe } from './shell.probe'
import { ScrollbackBuffer } from './scrollback'
import { cleanBaseEnv } from './agent.tools'
import { injectEnv } from './secrets.vault'

interface PtyRecord { proc: pty.IPty; buffer: ScrollbackBuffer }

// Keyed by session key — a bare ShellId for a global shell, or
// `${companyId}:${ShellId}` for a per-project shell (M3b). Per-project keying
// is what keeps one client's injected credentials out of another client's
// terminal: each project gets its own pty, spawned once with its own creds.
// createSession stays idempotent per key; sessions survive the dock closing.
const sessions = new Map<string, PtyRecord>()

function keyOf(shell: ShellId, companyId?: string): string {
  return companyId ? `${companyId}:${shell}` : shell
}

export function shellTabs(): ShellTab[] {
  return resolveShellTabs(process.platform, createRealShellProbe())
}

// Build the child environment: host env with credential-shaped vars stripped
// (cleanBaseEnv — resolves the standing "keep creds out of operator shells"
// warning), then the project's vault-injected creds overlaid. With no
// companyId (a global shell) only the strip happens — no project creds present.
function spawnEnv(companyId?: string): Record<string, string> {
  const base = cleanBaseEnv(process.env)
  return companyId ? { ...base, ...injectEnv(companyId) } : base
}

export function createSession(
  shell: ShellId,
  cols: number,
  rows: number,
  onData: (data: string) => void,
  companyId?: string,
): ShellCreateResult {
  const key = keyOf(shell, companyId)
  const existing = sessions.get(key)
  if (existing) {
    existing.proc.resize(cols, rows)
    return { sessionId: key, scrollback: existing.buffer.read() }
  }

  const { command, args } = resolveShellCommand(shell, process.platform, process.env)
  const proc = pty.spawn(command, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: os.homedir(),
    env: spawnEnv(companyId),
  })
  const buffer = new ScrollbackBuffer()
  proc.onData(data => { buffer.push(data); onData(data) })
  proc.onExit(() => { sessions.delete(key) })
  sessions.set(key, { proc, buffer })
  return { sessionId: key, scrollback: '' }
}

export function writeToSession(sessionId: string, data: string): void {
  sessions.get(sessionId)?.proc.write(data)
}

export function resizeSession(sessionId: string, cols: number, rows: number): void {
  sessions.get(sessionId)?.proc.resize(cols, rows)
}

export function killSession(sessionId: string): void {
  sessions.get(sessionId)?.proc.kill()
  sessions.delete(sessionId)
}

export function killAllSessions(): void {
  sessions.forEach(r => r.proc.kill())
  sessions.clear()
}

export function getSessionPid(sessionId: string): number | undefined {
  return sessions.get(sessionId)?.proc.pid
}
