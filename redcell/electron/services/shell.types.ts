export type ShellId = 'pwsh' | 'cmd' | 'kali'
export interface ShellTab { id: ShellId; label: string; color: string }
export interface ShellLine { kind: 'cmd' | 'out' | 'sys'; text: string; prompt?: string; promptColor?: string }
export interface ShellRunResult { lines: ShellLine[]; clear?: boolean }
