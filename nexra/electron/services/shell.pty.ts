import * as pty from 'node-pty'
import os from 'node:os'
import type { ShellId, ShellTab, ShellCreateResult } from './shell.types'
import { resolveShellTabs, resolveShellCommand } from './shell.resolve'
import { createRealShellProbe } from './shell.probe'
import { ScrollbackBuffer } from './scrollback'

interface PtyRecord { proc: pty.IPty; buffer: ScrollbackBuffer }

// Keyed by ShellId (not a per-call generated id): this app has exactly one
// shared terminal dock, so one session per shell type is the whole design.
// That's what makes createSession idempotent and every session always
// reachable by re-selecting its tab — no leaked/unreachable sessions short
// of app quit.
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
  if (existing) {
    existing.proc.resize(cols, rows)
    return { sessionId: shell, scrollback: existing.buffer.read() }
  }

  const { command, args } = resolveShellCommand(shell, process.platform, process.env)
  // Fine today: the main process's process.env holds no secrets. When a
  // later milestone (M3) wires a real provider API key for the live agent,
  // that key must NOT be added to process.env in a way that would flow into
  // these operator shells via env inheritance — keep provider credentials
  // out of process.env or explicitly strip them before spawning here.
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
