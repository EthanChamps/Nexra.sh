import { describe, it, expect } from 'vitest'
import { reducer, initialUI } from '../src/state/reducer'
import { activeChat, activeEngagement, chatByGlobalId } from '../src/state/selectors'
import { buildSnapshot } from '../electron/services/store.mock'

const boot = () => ({ data: buildSnapshot(), ui: initialUI })

describe('reducer', () => {
  it('opens a company into workspace with first engagement active', () => {
    const s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    expect(s.ui.view).toBe('workspace')
    expect(s.ui.activeCompanyId).toBe('c1')
    expect(activeEngagement(s)!.type).toBe('aws')
  })
  it('creates a company and lands in its empty workspace', () => {
    let s = reducer(boot(), { t: 'setNewCompanyName', value: 'Initech' })
    s = reducer(s, { t: 'createCompany' })
    expect(s.ui.view).toBe('workspace')
    expect(s.data.companies[0].name).toBe('Initech')
    expect(s.data.companies[0].engagements).toHaveLength(0)
  })
  it('creates a chat, makes it active, seeds a greeting', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    s = reducer(s, { t: 'selectEngagement', id: activeEngagement(s)!.id })
    const engId = s.ui.activeEngagementId!
    s = reducer(s, { t: 'openNewChat', engId })
    s = reducer(s, { t: 'setNewChatFocus', id: 'iam' })
    s = reducer(s, { t: 'createChat' })
    const chat = activeChat(s)!
    expect(chat.phaseId).toBe('iam')
    expect(chat.messages[0].role).toBe('assistant')
  })
  it('renames the active chat', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    s = reducer(s, { t: 'startRename' })
    s = reducer(s, { t: 'setNameDraft', value: 'Renamed' })
    s = reducer(s, { t: 'saveName' })
    expect(activeChat(s)!.name).toBe('Renamed')
  })
  it('upsertToolCard replaces a card in place by id (no duplicate on install)', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const chatId = activeEngagement(s)!.chats[0].id
    const before = chatByGlobalId(s, chatId)!.messages.length

    // Simulate clicking "Install" on an existing unavailable tool card: the
    // running event reuses the clicked card's own id...
    s = reducer(s, {
      t: 'upsertToolCard', chatId,
      card: { id: 'X', role: 'assistant', kind: 'tool', toolName: 'pmapper', command: 'install pmapper', state: 'running' },
    })
    // ...and the subsequent success event replaces that same id again.
    s = reducer(s, {
      t: 'upsertToolCard', chatId,
      card: { id: 'X', role: 'assistant', kind: 'tool', toolName: 'pmapper', command: 'install pmapper', state: 'success', output: 'installed', duration: '1.1s' },
    })

    const chat = chatByGlobalId(s, chatId)!
    const matches = chat.messages.filter(m => m.id === 'X')
    expect(matches).toHaveLength(1)
    expect(matches[0].state).toBe('success')
    expect(chat.messages).toHaveLength(before + 1)
  })
  it('deletes a chat and reassigns the active one', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const eng = activeEngagement(s)!
    const victim = eng.chats[0].id
    s = reducer(s, { t: 'ctxDelete', engId: eng.id, chatId: victim })
    expect(activeEngagement(s)!.chats.find(c => c.id === victim)).toBeUndefined()
  })
})
