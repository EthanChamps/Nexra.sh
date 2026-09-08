import { describe, it, expect } from 'vitest'
import { activeChat, getDraft, greetingFor } from '../src/state/selectors'
import { buildSnapshot } from '../electron/services/store.mock'
import { initialUI } from '../src/state/reducer'
import type { AppState } from '../src/state/selectors'

const boot = (): AppState => ({ data: buildSnapshot(), ui: initialUI })

describe('activeChat — pending chat resolution', () => {
  it('returns null when no chat (real or pending) is active for the engagement', () => {
    const s = boot()
    expect(activeChat(s)).toBeNull()
  })

  it('synthesizes a view-model chat for a pending (not-yet-persisted) chat', () => {
    const s = boot()
    const eng = s.data.companies[0].engagements[0]
    const ui = {
      ...s.ui,
      activeCompanyId: s.data.companies[0].id,
      activeEngagementId: eng.id,
      activeChatByEngagement: { [eng.id]: 'ch-pending-1' },
      pendingChatByEngagement: { [eng.id]: { id: 'ch-pending-1', draft: '' } },
    }
    const withPending: AppState = { data: s.data, ui }
    const chat = activeChat(withPending)
    expect(chat).not.toBeNull()
    expect(chat!.id).toBe('ch-pending-1')
    expect(chat!.name).toBe('New chat')
    expect(chat!.phaseId).toBe('')
    expect(chat!.color).toBe('#0a0b0d')
    expect(chat!.messages).toHaveLength(1)
    expect(chat!.messages[0].role).toBe('assistant')
    expect(chat!.messages[0].content).toBe(greetingFor(withPending, eng))
    // never actually written into the store
    expect(eng.chats.some(c => c.id === 'ch-pending-1')).toBe(false)
  })

  it('prefers a real chat over a stale pending entry pointing at a different id', () => {
    const s = boot()
    const eng = s.data.companies[0].engagements[0]
    const realChat = eng.chats[0]
    const ui = {
      ...s.ui,
      activeCompanyId: s.data.companies[0].id,
      activeEngagementId: eng.id,
      activeChatByEngagement: { [eng.id]: realChat.id },
      pendingChatByEngagement: { [eng.id]: { id: 'ch-pending-2', draft: 'ignored' } },
    }
    const withBoth: AppState = { data: s.data, ui }
    expect(activeChat(withBoth)!.id).toBe(realChat.id)
  })
})

describe('getDraft', () => {
  it('reads the pending chat draft while a pending chat is active', () => {
    const s = boot()
    const eng = s.data.companies[0].engagements[0]
    const ui = {
      ...s.ui,
      activeCompanyId: s.data.companies[0].id,
      activeEngagementId: eng.id,
      activeChatByEngagement: { [eng.id]: 'ch-pending-1' },
      pendingChatByEngagement: { [eng.id]: { id: 'ch-pending-1', draft: 'hello' } },
    }
    expect(getDraft({ data: s.data, ui })).toBe('hello')
  })

  it('reads the per-chat draft for a real chat, defaulting to empty string', () => {
    const s = boot()
    const eng = s.data.companies[0].engagements[0]
    const realChat = eng.chats[0]
    const ui = {
      ...s.ui,
      activeCompanyId: s.data.companies[0].id,
      activeEngagementId: eng.id,
      activeChatByEngagement: { [eng.id]: realChat.id },
      draftByChatId: { [realChat.id]: 'unsent reply' },
    }
    expect(getDraft({ data: s.data, ui })).toBe('unsent reply')
    expect(getDraft({ data: s.data, ui: { ...ui, draftByChatId: {} } })).toBe('')
  })
})
