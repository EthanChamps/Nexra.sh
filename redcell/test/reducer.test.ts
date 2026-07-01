import { describe, it, expect } from 'vitest'
import { reducer, initialUI } from '../src/state/reducer'
import { activeChat, activeEngagement } from '../src/state/selectors'
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
  it('deletes a chat and reassigns the active one', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const eng = activeEngagement(s)!
    const victim = eng.chats[0].id
    s = reducer(s, { t: 'ctxDelete', engId: eng.id, chatId: victim })
    expect(activeEngagement(s)!.chats.find(c => c.id === victim)).toBeUndefined()
  })
})
