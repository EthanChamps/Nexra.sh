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
