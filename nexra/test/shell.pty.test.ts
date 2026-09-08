// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest'
// This is a real Node PTY test, not an Electron runtime. No vault access is
// needed for global sessions; stub the Electron-only encryption boundary.
vi.mock('electron', () => ({ safeStorage: {} }))
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
