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
