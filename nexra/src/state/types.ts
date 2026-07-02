import type { ShellId } from '../../electron/services/shell.types'

export interface CtxMenuState { open: boolean; x: number; y: number; engId: string | null; chatId: string | null }
export interface CompanyCtxMenuState { open: boolean; x: number; y: number; companyId: string | null }

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
  renamingCompanyId: string | null; companyNameDraft: string
  companyCtxMenu: CompanyCtxMenuState
  confirmDeleteCompanyId: string | null
  terminalOpen: boolean; terminalShell: ShellId; terminalHeight: number
  settingsOpen: boolean
  streamingChats: Record<string, true>
}
