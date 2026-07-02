export type ShellId = 'pwsh' | 'cmd' | 'kali' | 'shell'
export interface ShellTab { id: ShellId; label: string; color: string }
export interface ShellCreateResult { sessionId: ShellId; scrollback: string }
