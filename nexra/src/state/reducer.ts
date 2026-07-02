import type { AppState } from './selectors'
import { activeCompany, engagementById, chatByIds, chatByGlobalId } from './selectors'
import type { UIState } from './types'
import type { Chat, Message, Finding, Phase } from '../../electron/services/store.types'
import { chatColors } from '../../electron/services/seed'

let _id = 1000
const nextId = (p: string) => p + (++_id)

// Fallback title when the live cheap-model call (see agent.title.ts) fails —
// derives a short title from the user's first question. Pure/deterministic.
export function deriveTitle(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean).slice(0, 6)
  const cleaned = words.join(' ').replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '').slice(0, 48).trim()
  if (!cleaned) return 'New chat'
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

// M1 stand-in for M2 context focus inference: pick the phase whose leading
// keyword appears in the first message; fall back to the first phase.
export function inferFocus(text: string, phases: Phase[]): string {
  const lower = text.toLowerCase()
  const match = phases.find(p => {
    const key = p.label.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)[0]
    return key ? lower.includes(key) : false
  })
  return (match || phases[0])?.id ?? ''
}

export const initialUI: UIState = {
  view: 'home', activeCompanyId: null, activeEngagementId: null, activeChatByEngagement: {},
  draft: '', rightOpen: true, editingName: false, nameDraft: '', colorMenuOpen: false,
  newProjectOpen: false, newCompanyName: '', newOpen: false, selectedType: 'aws', newName: '',
  ctxMenu: { open: false, x: 0, y: 0, engId: null, chatId: null },
  renamingCompanyId: null, companyNameDraft: '',
  companyCtxMenu: { open: false, x: 0, y: 0, companyId: null },
  confirmDeleteCompanyId: null,
  terminalOpen: false, terminalShell: 'pwsh', terminalHeight: 346,
  settingsOpen: false,
  streamingChats: {},
}

// Build the initial active-chat map from seed (first chat of each engagement).
export function initialActiveMap(s: AppState): Record<string, string> {
  const map: Record<string, string> = {}
  s.data.companies.forEach(c => c.engagements.forEach(e => { if (e.chats[0]) map[e.id] = e.chats[0].id }))
  return map
}

function makeChat(state: AppState, engId: string): Chat {
  const eng = engagementById(state, engId)!
  const cfg = state.data.types[eng.type]
  const greeting: Message = { id: nextId('m'), role: 'assistant', kind: 'text',
    content: "I'm the agent for this " + cfg.label + ". Ask me to enumerate configuration, run automated checks, or log findings — this chat keeps its own context." }
  return { id: nextId('ch'), name: 'New chat', phaseId: '', color: '#0a0b0d', messages: [greeting], findings: [], tools: cfg.tools.map(t => ({ ...t })) }
}

function engagementForChat(state: AppState, chatId: string) {
  for (const c of state.data.companies)
    for (const e of c.engagements)
      if (e.chats.some(ch => ch.id === chatId)) return e
  return null
}

export type Action =
  | { t: 'hydrate'; data: AppState['data'] }
  | { t: 'seedActiveMap'; map: Record<string, string> }
  | { t: 'openCompany'; id: string } | { t: 'goHome' }
  | { t: 'selectEngagement'; id: string } | { t: 'selectChat'; id: string }
  | { t: 'toggleRight' }
  | { t: 'openNewProject' } | { t: 'closeNewProject' } | { t: 'setNewCompanyName'; value: string } | { t: 'createCompany' }
  | { t: 'openNew' } | { t: 'closeNew' } | { t: 'setSelectedType'; id: string } | { t: 'setNewName'; value: string } | { t: 'createProject' }
  | { t: 'createChat'; engId?: string }
  | { t: 'startRename' } | { t: 'setNameDraft'; value: string } | { t: 'saveName' } | { t: 'cancelRename' }
  | { t: 'setChatColor'; bg: string }
  | { t: 'openCtx'; x: number; y: number; engId: string; chatId: string } | { t: 'closeCtx' } | { t: 'ctxRename' } | { t: 'ctxSetColor'; bg: string } | { t: 'ctxDelete'; engId: string; chatId: string }
  | { t: 'startRenameCompany'; id: string } | { t: 'setCompanyNameDraft'; value: string } | { t: 'saveCompanyName' } | { t: 'cancelRenameCompany' }
  | { t: 'openCompanyCtx'; x: number; y: number; companyId: string } | { t: 'closeCompanyCtx' }
  | { t: 'requestDeleteCompany'; id: string } | { t: 'cancelDeleteCompany' } | { t: 'confirmDeleteCompany' }
  | { t: 'setDraft'; value: string }
  | { t: 'toggleTerminal' } | { t: 'closeTerminal' } | { t: 'setTerminalShell'; id: UIState['terminalShell'] } | { t: 'setTerminalHeight'; h: number }
  | { t: 'openSettings' } | { t: 'closeSettings' }
  | { t: 'replaceData'; data: AppState['data'] }
  | { t: 'appendUserMessage'; chatId: string; text: string }
  | { t: 'setChatTitle'; chatId: string; title: string }
  | { t: 'appendText'; chatId: string; text: string }
  | { t: 'upsertToolCard'; chatId: string; card: Message }
  | { t: 'appendFinding'; chatId: string; finding: Finding }
  | { t: 'markToolAvailable'; chatId: string; toolName: string }
  | { t: 'appendTextDelta'; chatId: string; delta: string }
  | { t: 'appendError'; chatId: string; message: string }
  | { t: 'setStreaming'; chatId: string; on: boolean }

const clone = (s: AppState): AppState => ({ data: { ...s.data, companies: s.data.companies.map(c => ({ ...c, engagements: c.engagements.map(e => ({ ...e, chats: e.chats.map(ch => ({ ...ch, messages: [...ch.messages], findings: [...ch.findings], tools: [...ch.tools] })) })) })) }, ui: { ...s.ui, activeChatByEngagement: { ...s.ui.activeChatByEngagement }, ctxMenu: { ...s.ui.ctxMenu }, companyCtxMenu: { ...s.ui.companyCtxMenu }, streamingChats: { ...s.ui.streamingChats } } })

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
    case 'createChat': {
      const id = a.engId || U.activeEngagementId; const eng = id ? engagementById(s, id) : null; if (!eng) return state
      U.activeEngagementId = eng.id
      const chat = makeChat(s, eng.id)
      eng.chats = [chat, ...eng.chats]; eng.updated = 'just now'
      U.activeChatByEngagement[eng.id] = chat.id; U.editingName = false; return s
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
    case 'startRenameCompany': { const c = s.data.companies.find(x => x.id === a.id); if (!c) return state; U.renamingCompanyId = a.id; U.companyNameDraft = c.name; U.companyCtxMenu = { ...U.companyCtxMenu, open: false }; return s }
    case 'setCompanyNameDraft': U.companyNameDraft = a.value; return s
    case 'saveCompanyName': { if (!U.renamingCompanyId) return state; const name = U.companyNameDraft.trim(); const c = s.data.companies.find(x => x.id === U.renamingCompanyId); if (c && name) c.name = name; U.renamingCompanyId = null; return s }
    case 'cancelRenameCompany': U.renamingCompanyId = null; return s
    case 'openCompanyCtx': U.companyCtxMenu = { open: true, x: a.x, y: a.y, companyId: a.companyId }; return s
    case 'closeCompanyCtx': U.companyCtxMenu = { ...U.companyCtxMenu, open: false }; return s
    case 'requestDeleteCompany': U.confirmDeleteCompanyId = a.id; U.companyCtxMenu = { ...U.companyCtxMenu, open: false }; return s
    case 'cancelDeleteCompany': U.confirmDeleteCompanyId = null; return s
    case 'confirmDeleteCompany': {
      if (!U.confirmDeleteCompanyId) return state
      const id = U.confirmDeleteCompanyId
      s.data.companies = s.data.companies.filter(c => c.id !== id)
      if (U.activeCompanyId === id) { U.activeCompanyId = null; U.activeEngagementId = null; U.view = 'home' }
      U.confirmDeleteCompanyId = null
      return s
    }
    case 'setDraft': U.draft = a.value; return s
    case 'toggleTerminal': U.terminalOpen = !U.terminalOpen; return s
    case 'closeTerminal': U.terminalOpen = false; return s
    case 'setTerminalShell': U.terminalShell = a.id; return s
    case 'setTerminalHeight': U.terminalHeight = a.h; return s
    case 'openSettings': U.settingsOpen = true; return s
    case 'closeSettings': U.settingsOpen = false; return s
    case 'replaceData': case 'hydrate': s.data = a.data; return s
    case 'seedActiveMap': U.activeChatByEngagement = a.map; return s
    case 'appendUserMessage': {
      const c = chatByGlobalId(s, a.chatId); if (!c) return state
      const firstUser = !c.messages.some(m => m.role === 'user')
      c.messages.push({ id: nextId('m'), role: 'user', kind: 'text', content: a.text })
      // First question on a still-provisional chat → infer focus. The title
      // itself arrives asynchronously via 'setChatTitle' once the live
      // cheap-model call resolves (see ipc.ts sendMessage).
      if (firstUser && c.name === 'New chat') {
        const eng = engagementForChat(s, a.chatId)
        if (eng) c.phaseId = inferFocus(a.text, eng.phases)
      }
      return s
    }
    case 'setChatTitle': {
      const c = chatByGlobalId(s, a.chatId); if (!c) return state
      if (c.name === 'New chat') c.name = a.title
      return s
    }
    case 'appendText': {
      const c = chatByGlobalId(s, a.chatId); if (!c) return state
      c.messages.push({ id: nextId('m'), role: 'assistant', kind: 'text', content: a.text })
      return s
    }
    case 'upsertToolCard': {
      const c = chatByGlobalId(s, a.chatId); if (!c) return state
      const idx = c.messages.findIndex(m => m.id === a.card.id)
      if (idx >= 0) c.messages[idx] = a.card
      else c.messages.push(a.card)
      return s
    }
    case 'appendFinding': {
      const c = chatByGlobalId(s, a.chatId); if (!c) return state
      c.findings.push(a.finding)
      return s
    }
    case 'markToolAvailable': {
      const c = chatByGlobalId(s, a.chatId); if (!c) return state
      const tool = c.tools.find(t => t.name === a.toolName)
      if (tool) tool.available = true
      return s
    }
    case 'appendTextDelta': {
      const c = chatByGlobalId(s, a.chatId); if (!c) return state
      const idx = c.messages.length - 1
      const last = c.messages[idx]
      if (last && last.role === 'assistant' && last.kind === 'text')
        c.messages[idx] = { ...last, content: (last.content ?? '') + a.delta }
      else
        c.messages.push({ id: nextId('m'), role: 'assistant', kind: 'text', content: a.delta })
      return s
    }
    case 'appendError': {
      const c = chatByGlobalId(s, a.chatId); if (!c) return state
      c.messages.push({ id: nextId('m'), role: 'assistant', kind: 'text', content: '⚠ ' + a.message })
      return s
    }
    case 'setStreaming': {
      if (a.on) U.streamingChats[a.chatId] = true
      else delete U.streamingChats[a.chatId]
      return s
    }
    default: return state
  }
}
export { chatColors }
