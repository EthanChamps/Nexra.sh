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
