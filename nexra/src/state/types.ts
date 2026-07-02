import type { ShellId } from '../../electron/services/shell.types'

export interface CtxMenuState { open: boolean; x: number; y: number; engId: string | null; chatId: string | null }

export interface UIState {
  view: 'home' | 'workspace'
  activeCompanyId: string | null
  activeEngagementId: string | null
  activeChatByEngagement: Record<string, string>
  draft: string
  rightOpen: boolean
  editingName: boolean; nameDraft: string
  colorMenuOpen: boolean
  newProjectOpen: boolean; newCompanyName: string
  newOpen: boolean; selectedType: string; newName: string
  ctxMenu: CtxMenuState
  terminalOpen: boolean; terminalShell: ShellId; terminalHeight: number; terminalInput: string
  settingsOpen: boolean
}
