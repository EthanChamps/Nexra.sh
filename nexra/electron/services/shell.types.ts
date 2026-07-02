export type ShellId = 'pwsh' | 'cmd' | 'kali' | 'shell'
export interface ShellTab { id: ShellId; label: string; color: string }
// sessionId is the registry key: a bare ShellId for a global shell, or
// `${companyId}:${ShellId}` for a per-project shell (M3b). Opaque to callers.
export interface ShellCreateResult { sessionId: string; scrollback: string }
