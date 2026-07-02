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
