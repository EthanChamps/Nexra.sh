import type { AppState } from './selectors'
import { activeCompany, activeEngagement, engagementById, chatByIds } from './selectors'
import type { UIState } from './types'
import type { Chat, Message } from '../../electron/services/store.types'
import { chatColors } from '../../electron/services/seed'

let _id = 1000
const nextId = (p: string) => p + (++_id)

export const initialUI: UIState = {
  view: 'home', activeCompanyId: null, activeEngagementId: null, activeChatByEngagement: {},
  draft: '', rightOpen: true, editingName: false, nameDraft: '', colorMenuOpen: false,
  newProjectOpen: false, newCompanyName: '', newOpen: false, selectedType: 'aws', newName: '',
  newChatOpen: false, newChatName: '', newChatFocus: '', newChatColor: '#0a0b0d',
  ctxMenu: { open: false, x: 0, y: 0, engId: null, chatId: null },
  terminalOpen: false, terminalShell: 'pwsh', terminalHeight: 346, terminalInput: '',
  settingsOpen: false,
}

// Build the initial active-chat map from seed (first chat of each engagement).
export function initialActiveMap(s: AppState): Record<string, string> {
  const map: Record<string, string> = {}
  s.data.companies.forEach(c => c.engagements.forEach(e => { if (e.chats[0]) map[e.id] = e.chats[0].id }))
  return map
}

function makeChat(state: AppState, engId: string, phaseId: string, name: string, color: string): Chat {
  const eng = engagementById(state, engId)!
  const cfg = state.data.types[eng.type]
  const ph = cfg.phases.find(p => p.id === phaseId) || cfg.phases[0]
  const greeting: Message = { id: nextId('m'), role: 'assistant', kind: 'text',
    content: "I'm the " + ph.label + " agent for this " + cfg.label + ". Ask me to enumerate configuration, run automated checks, or log findings — this chat keeps its own context." }
  return { id: nextId('ch'), name: name || ph.label, phaseId: ph.id, color: color || '#0a0b0d', messages: [greeting], findings: [], tools: cfg.tools.map(t => ({ ...t })) }
}

export type Action =
  | { t: 'hydrate'; data: AppState['data'] }
  | { t: 'openCompany'; id: string } | { t: 'goHome' }
  | { t: 'selectEngagement'; id: string } | { t: 'selectChat'; id: string }
  | { t: 'toggleRight' }
  | { t: 'openNewProject' } | { t: 'closeNewProject' } | { t: 'setNewCompanyName'; value: string } | { t: 'createCompany' }
  | { t: 'openNew' } | { t: 'closeNew' } | { t: 'setSelectedType'; id: string } | { t: 'setNewName'; value: string } | { t: 'createProject' }
  | { t: 'openNewChat'; engId?: string } | { t: 'closeNewChat' } | { t: 'setNewChatName'; value: string } | { t: 'setNewChatFocus'; id: string } | { t: 'setNewChatColor'; bg: string } | { t: 'createChat' }
  | { t: 'startRename' } | { t: 'setNameDraft'; value: string } | { t: 'saveName' } | { t: 'cancelRename' }
  | { t: 'setChatColor'; bg: string }
  | { t: 'openCtx'; x: number; y: number; engId: string; chatId: string } | { t: 'closeCtx' } | { t: 'ctxRename' } | { t: 'ctxSetColor'; bg: string } | { t: 'ctxDelete'; engId: string; chatId: string }
  | { t: 'setDraft'; value: string }
  | { t: 'toggleTerminal' } | { t: 'closeTerminal' } | { t: 'setTerminalShell'; id: UIState['terminalShell'] } | { t: 'setTerminalInput'; value: string } | { t: 'setTerminalHeight'; h: number }
  | { t: 'openSettings' } | { t: 'closeSettings' }
  | { t: 'replaceData'; data: AppState['data'] }

const clone = (s: AppState): AppState => ({ data: { ...s.data, companies: s.data.companies.map(c => ({ ...c, engagements: c.engagements.map(e => ({ ...e, chats: e.chats.map(ch => ({ ...ch, messages: [...ch.messages], findings: [...ch.findings], tools: [...ch.tools] })) })) })) }, ui: { ...s.ui, activeChatByEngagement: { ...s.ui.activeChatByEngagement }, ctxMenu: { ...s.ui.ctxMenu } } })

export function reducer(state: AppState, a: Action): AppState {
  const s = clone(state)
  const U = s.ui
  switch (a.t) {
    case 'openCompany': {
      const c = s.data.companies.find(x => x.id === a.id)
      const first = c && c.engagements[0]
      U.view = 'workspace'; U.activeCompanyId = a.id; U.activeEngagementId = first ? first.id : null
      U.editingName = false; U.colorMenuOpen = false
      c?.engagements.forEach(e => { if (!U.activeChatByEngagement[e.id] && e.chats[0]) U.activeChatByEngagement[e.id] = e.chats[0].id })
      return s
    }
    case 'goHome': U.view = 'home'; U.editingName = false; U.colorMenuOpen = false; return s
    case 'selectEngagement': {
      const e = engagementById(s, a.id)
      if (e && !U.activeChatByEngagement[e.id] && e.chats[0]) U.activeChatByEngagement[e.id] = e.chats[0].id
      U.activeEngagementId = a.id; U.editingName = false; U.colorMenuOpen = false; return s
    }
    case 'selectChat': U.activeChatByEngagement[U.activeEngagementId!] = a.id; U.editingName = false; U.colorMenuOpen = false; return s
    case 'toggleRight': U.rightOpen = !U.rightOpen; return s
    case 'openNewProject': U.newProjectOpen = true; U.newCompanyName = ''; return s
    case 'closeNewProject': U.newProjectOpen = false; return s
    case 'setNewCompanyName': U.newCompanyName = a.value; return s
    case 'createCompany': {
      const name = U.newCompanyName.trim(); if (!name) return state
      const id = nextId('c')
      s.data.companies = [{ id, name, updated: 'just now', engagements: [] }, ...s.data.companies]
      U.newProjectOpen = false; U.view = 'workspace'; U.activeCompanyId = id; U.activeEngagementId = null; U.editingName = false; return s
    }
    case 'openNew': U.newOpen = true; U.selectedType = 'aws'; U.newName = ''; return s
    case 'closeNew': U.newOpen = false; return s
    case 'setSelectedType': U.selectedType = a.id; return s
    case 'setNewName': U.newName = a.value; return s
    case 'createProject': {
      const cfg = s.data.types[U.selectedType as keyof typeof s.data.types]
      const eng = { id: nextId('e'), type: U.selectedType as any, name: U.newName.trim() || cfg.label, status: 'In Progress' as const, updated: 'just now', linear: cfg.linear, phases: cfg.phases, scope: cfg.scope.map(x => ({ ...x })), chats: [] }
      const c = activeCompany(s)!; c.updated = 'just now'; c.engagements = [eng, ...c.engagements]
      U.activeEngagementId = eng.id; U.newOpen = false; U.editingName = false; return s
    }
    case 'openNewChat': {
      const id = a.engId || U.activeEngagementId; const eng = id ? engagementById(s, id) : null; if (!eng) return state
      U.activeEngagementId = eng.id; U.newChatOpen = true; U.newChatName = ''; U.newChatFocus = eng.phases[0].id; U.newChatColor = '#0a0b0d'; return s
    }
    case 'closeNewChat': U.newChatOpen = false; return s
    case 'setNewChatName': U.newChatName = a.value; return s
    case 'setNewChatFocus': U.newChatFocus = a.id; return s
    case 'setNewChatColor': U.newChatColor = a.bg; return s
    case 'createChat': {
      const eng = activeEngagement(s); if (!eng) return state
      const chat = makeChat(s, eng.id, U.newChatFocus, U.newChatName.trim(), U.newChatColor)
      eng.chats = [chat, ...eng.chats]; eng.updated = 'just now'
      U.activeChatByEngagement[eng.id] = chat.id; U.newChatOpen = false; U.editingName = false; return s
    }
    case 'startRename': { const c = chatByIds(s, U.activeEngagementId!, U.activeChatByEngagement[U.activeEngagementId!]); if (c) { U.editingName = true; U.nameDraft = c.name; U.colorMenuOpen = false } return s }
    case 'setNameDraft': U.nameDraft = a.value; return s
    case 'saveName': { if (!U.editingName) return state; const name = U.nameDraft.trim(); const c = chatByIds(s, U.activeEngagementId!, U.activeChatByEngagement[U.activeEngagementId!]); if (c && name) c.name = name; U.editingName = false; return s }
    case 'cancelRename': U.editingName = false; return s
    case 'setChatColor': { const c = chatByIds(s, U.activeEngagementId!, U.activeChatByEngagement[U.activeEngagementId!]); if (c) c.color = a.bg; U.colorMenuOpen = false; return s }
    case 'openCtx': U.ctxMenu = { open: true, x: a.x, y: a.y, engId: a.engId, chatId: a.chatId }; U.colorMenuOpen = false; return s
    case 'closeCtx': U.ctxMenu = { ...U.ctxMenu, open: false }; return s
    case 'ctxRename': { const { engId, chatId } = U.ctxMenu; const c = chatByIds(s, engId!, chatId!); if (!c) return state; U.activeEngagementId = engId; U.activeChatByEngagement[engId!] = chatId!; U.editingName = true; U.nameDraft = c.name; U.ctxMenu = { ...U.ctxMenu, open: false }; return s }
    case 'ctxSetColor': { const { engId, chatId } = U.ctxMenu; const c = chatByIds(s, engId!, chatId!); if (c) c.color = a.bg; U.ctxMenu = { ...U.ctxMenu, open: false }; return s }
    case 'ctxDelete': { const e = engagementById(s, a.engId); if (!e) return state; e.chats = e.chats.filter(c => c.id !== a.chatId); if (U.activeChatByEngagement[a.engId] === a.chatId) { if (e.chats[0]) U.activeChatByEngagement[a.engId] = e.chats[0].id; else delete U.activeChatByEngagement[a.engId] } U.ctxMenu = { ...U.ctxMenu, open: false }; return s }
    case 'setDraft': U.draft = a.value; return s
    case 'toggleTerminal': U.terminalOpen = !U.terminalOpen; return s
    case 'closeTerminal': U.terminalOpen = false; return s
    case 'setTerminalShell': U.terminalShell = a.id; return s
    case 'setTerminalInput': U.terminalInput = a.value; return s
    case 'setTerminalHeight': U.terminalHeight = a.h; return s
    case 'openSettings': U.settingsOpen = true; return s
    case 'closeSettings': U.settingsOpen = false; return s
    case 'replaceData': case 'hydrate': s.data = a.data; return s
    default: return state
  }
}
export { chatColors }
