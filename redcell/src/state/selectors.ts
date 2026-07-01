import type { Snapshot, Company, Engagement, Chat, Severity } from '../../electron/services/store.types'
import type { UIState } from './types'
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
export const activeChat = (s: AppState): Chat | null => {
  const e = activeEngagement(s); if (!e) return null
  const id = s.ui.activeChatByEngagement[e.id]
  return e.chats.find(ch => ch.id === id) || null
}
export const chatByIds = (s: AppState, engId: string, chatId: string): Chat | null => {
  const e = engagementById(s, engId); if (!e) return null
  return e.chats.find(c => c.id === chatId) || null
}

export const monogram = (name: string): string => {
  const w = (name || '').trim().split(/\s+/).filter(Boolean)
  const str = ((w[0] || '')[0] || '') + ((w[1] || '')[0] || '')
  return (str || (name || '').slice(0, 2)).toUpperCase()
}
export const phaseLabel = (eng: Engagement | null, id: string): string =>
  (eng?.phases.find(p => p.id === id) || { label: '' }).label
export const statusColor = (st: string): string => (st === 'Complete' ? '#46c47f' : '#e6a23c')
export const sevColor = (sev: Severity): string =>
  ({ Critical: '#f0616d', High: '#f0954a', Medium: '#e6b23f', Low: '#7c828b' } as const)[sev]
