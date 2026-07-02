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
