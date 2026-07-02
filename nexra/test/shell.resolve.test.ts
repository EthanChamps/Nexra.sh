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
