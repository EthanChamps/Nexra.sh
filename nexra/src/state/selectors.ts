import type { Snapshot, Company, Engagement, Chat, Severity } from '../../electron/services/store.types'
import type { UIState } from './types'
import { chatColors } from '../../electron/services/seed'
export interface AppState { data: Snapshot; ui: UIState }

export const activeCompany = (s: AppState): Company | null =>
  s.data.companies.find(c => c.id === s.ui.activeCompanyId) || null
export const activeEngagement = (s: AppState): Engagement | null => {
  const c = activeCompany(s); if (!c) return null
  return c.engagements.find(e => e.id === s.ui.activeEngagementId) || null
}
export const engagementById = (s: AppState, id: string): Engagement | null => {
  const c = activeCompany(s); if (!c) return null
  return c.engagements.find(e => e.id === id) || null
}
// The M1 stand-in greeting (see reducer.ts makeChat) — shared with the pending-chat
// view-model below so a not-yet-persisted "new chat" reads identically to a real one.
export const greetingFor = (s: AppState, eng: Engagement): string => {
  const cfg = s.data.types[eng.type]
  return "I'm the agent for this " + cfg.label + ". Ask me to enumerate configuration, run automated checks, or log findings — this chat keeps its own context."
}
export const activeChat = (s: AppState): Chat | null => {
  const e = activeEngagement(s); if (!e) return null
  const id = s.ui.activeChatByEngagement[e.id]
  const real = e.chats.find(ch => ch.id === id)
  if (real) return real
  const pending = s.ui.pendingChatByEngagement[e.id]
  if (!pending || pending.id !== id) return null
  return {
    id: pending.id, name: 'New chat', phaseId: '', color: '#0a0b0d', findings: [],
    messages: [{ id: 'pending-greeting-' + pending.id, role: 'assistant', kind: 'text', content: greetingFor(s, e) }],
  }
}
export const chatByIds = (s: AppState, engId: string, chatId: string): Chat | null => {
  const e = engagementById(s, engId); if (!e) return null
  return e.chats.find(c => c.id === chatId) || null
}
// Scans every company/engagement/chat — needed because agent events only carry a chatId,
// not the active company/engagement context (the active-chat helpers above aren't enough).
export const chatByGlobalId = (s: AppState, chatId: string): Chat | null => {
  for (const c of s.data.companies) {
    for (const e of c.engagements) {
      const ch = e.chats.find(x => x.id === chatId)
      if (ch) return ch
    }
  }
  return null
}

// Per-chat composer draft — resolves to the pending chat's own draft slot while
// viewing an uncommitted "new chat", else the persisted chat's draftByChatId entry.
export const getDraft = (s: AppState): string => {
  const e = activeEngagement(s); if (!e) return ''
  const id = s.ui.activeChatByEngagement[e.id]
  const pending = s.ui.pendingChatByEngagement[e.id]
  if (pending && pending.id === id) return pending.draft
  return id ? (s.ui.draftByChatId[id] ?? '') : ''
}

export const phaseLabel = (eng: Engagement | null, id: string): string =>
  (eng?.phases.find(p => p.id === id) || { label: '' }).label
export const statusColor = (st: string): string => (st === 'Complete' ? '#46c47f' : '#e6a23c')
export const sevColor = (sev: Severity): string =>
  ({ Critical: '#f0616d', High: '#f0954a', Medium: '#e6b23f', Low: '#7c828b' } as const)[sev]
export const colorDot = (bg: string): string => chatColors.find(c => c.bg === bg)?.dot ?? chatColors[0].dot
