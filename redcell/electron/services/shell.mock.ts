import type { ShellId, ShellRunResult, ShellTab, ShellLine } from './shell.types'
import { terminalShells } from './seed'

export const shellTabs = (): ShellTab[] => terminalShells.map(s => ({ ...s }))
export const shellColor = (shell: ShellId) => terminalShells.find(s => s.id === shell)?.color || '#9aa2f5'
export const shellPromptStored = (shell: ShellId) => shell === 'kali' ? '┌──(kali㉿kali)-[~]\n└─$' : shell === 'cmd' ? 'C:\\Users\\pentester>' : 'PS C:\\Users\\pentester>'
export const inlinePrompt = (shell: ShellId) => shell === 'kali' ? '└─$' : shell === 'cmd' ? 'C:\\Users\\pentester>' : 'PS C:\\Users\\pentester>'

export function runShell(shell: ShellId, raw: string): ShellRunResult {
  const parts = raw.trim().split(/\s+/); const cmd = (parts[0] || '').toLowerCase()
  const out = (text: string): ShellLine => ({ kind: 'out', text })
  if (cmd === 'clear' || cmd === 'cls') return { lines: [], clear: true }
  if (cmd === 'help') return { lines: [out('Demo commands: whoami · pwd · ls / dir · ipconfig / ifconfig · nmap <target> · nikto · clear\nAnything else returns a realistic shell response. This is a UI mock — no real commands execute.')] }
  if (cmd === 'whoami') return { lines: [out(shell === 'kali' ? 'kali' : 'desktop-pt01\\pentester')] }
  if (cmd === 'pwd') return { lines: [out(shell === 'kali' ? '/home/kali' : 'C:\\Users\\pentester')] }
  if (cmd === 'ls' || cmd === 'dir') {
    if (shell === 'kali') return { lines: [out('Desktop   Documents   loot   scans   wordlists')] }
    return { lines: [out(' Directory: C:\\Users\\pentester\n\nMode    LastWriteTime        Length Name\n----    -------------        ------ ----\nd----   6/28/2026   9:14 AM          loot\nd----   6/28/2026   9:02 AM          scans\n-a---   6/30/2026   4:41 PM    2088  scope.txt')] }
  }
  if (cmd === 'ipconfig' || cmd === 'ifconfig' || cmd === 'ip') {
    if (shell === 'kali') return { lines: [out('eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500\n        inet 10.10.14.7  netmask 255.255.0.0  broadcast 10.10.255.255\n        ether 00:15:5d:6a:12:0b  txqueuelen 1000  (Ethernet)')] }
    return { lines: [out('Windows IP Configuration\n\nEthernet adapter Ethernet:\n   IPv4 Address. . . . . . . : 10.10.14.7\n   Subnet Mask . . . . . . . : 255.255.0.0\n   Default Gateway . . . . . : 10.10.0.1')] }
  }
  if (cmd === 'nmap') {
    const tgt = parts.slice(1).find(p => !p.startsWith('-')) || '10.10.0.5'
    return { lines: [out('Starting Nmap 7.94 ( https://nmap.org )\nNmap scan report for ' + tgt + '\nHost is up (0.0021s latency).\n\nPORT     STATE SERVICE\n22/tcp   open  ssh\n135/tcp  open  msrpc\n445/tcp  open  microsoft-ds\n3389/tcp open  ms-wbt-server\n\nNmap done: 1 IP address (1 host up) scanned in 4.30s')] }
  }
  if (cmd === 'nikto') return { lines: [out('- Nikto v2.5.0\n+ Target IP:          10.10.14.7\n+ Server: nginx/1.24.0\n+ /admin/: Admin login page identified.\n+ 7 host(s) tested')] }
  if (cmd === '') return { lines: [] }
  if (shell === 'kali') return { lines: [out(parts[0] + ': command not found')] }
  if (shell === 'cmd') return { lines: [out("'" + parts[0] + "' is not recognized as an internal or external command,\noperable program or batch file.")] }
  return { lines: [out(parts[0] + " : The term '" + parts[0] + "' is not recognized as the name of a cmdlet, function, script file, or operable program.")] }
}
