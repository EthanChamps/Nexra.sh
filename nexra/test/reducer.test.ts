import { describe, it, expect } from 'vitest'
import { reducer, initialUI, deriveTitle, inferFocus } from '../src/state/reducer'
import { activeChat, activeEngagement, chatByGlobalId } from '../src/state/selectors'
import { buildSnapshot } from '../electron/services/store.mock'
import type { Finding } from '../electron/services/store.types'

const boot = () => ({ data: buildSnapshot(), ui: initialUI })

const mkFinding = (over: Partial<Finding> = {}): Finding => ({
  id: 'f1', title: 'Public S3 bucket', sev: 'High', phase: 'Storage', time: 'just now',
  rationale: 'World-readable ACL', evidence: [], verified: false, ...over,
})

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
  it('creates a provisional chat, makes it active, seeds a greeting', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const engId = activeEngagement(s)!.id
    s = reducer(s, { t: 'createChat', engId })
    const chat = activeChat(s)!
    expect(chat.name).toBe('New chat')
    expect(chat.phaseId).toBe('')
    expect(chat.color).toBe('#0a0b0d')
    expect(chat.messages[0].role).toBe('assistant')
  })
  it('advances the id counter past hydrated ids so a new chat cannot collide (dup-highlight bug)', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const engId = activeEngagement(s)!.id
    // Probe the live counter, then build "persisted" data whose chat id sits well
    // above it — mimics a relaunch where the counter reset to 1000 but sqlite
    // still holds higher ids minted in a prior session.
    s = reducer(s, { t: 'createChat', engId })
    const probe = parseInt(activeChat(s)!.id.replace(/^\D+/, ''), 10)
    const highNum = probe + 500
    const data = JSON.parse(JSON.stringify(s.data)) as typeof s.data
    const eng = data.companies.flatMap((c: any) => c.engagements).find((e: any) => e.id === engId)
    eng.chats.unshift({ id: 'ch' + highNum, name: 'Persisted', phaseId: '', color: '#0a0b0d', messages: [], findings: [], tools: [] })

    s = reducer(s, { t: 'hydrate', data })
    s = reducer(s, { t: 'createChat', engId })

    const newNum = parseInt(activeChat(s)!.id.replace(/^\D+/, ''), 10)
    const ids = activeEngagement(s)!.chats.map(c => c.id)
    expect(newNum).toBeGreaterThan(highNum)                       // clears the hydrated id
    expect(new Set(ids).size).toBe(ids.length)                   // no duplicate ids
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
  it('renames a company', () => {
    let s = reducer(boot(), { t: 'startRenameCompany', id: 'c1' })
    expect(s.ui.renamingCompanyId).toBe('c1')
    expect(s.ui.companyNameDraft).toBe(s.data.companies.find(c => c.id === 'c1')!.name)
    s = reducer(s, { t: 'setCompanyNameDraft', value: 'Renamed Co' })
    s = reducer(s, { t: 'saveCompanyName' })
    expect(s.data.companies.find(c => c.id === 'c1')!.name).toBe('Renamed Co')
    expect(s.ui.renamingCompanyId).toBeNull()
  })
  it('reverts to the previous name when saving an empty rename', () => {
    let s = reducer(boot(), { t: 'startRenameCompany', id: 'c1' })
    const original = s.data.companies.find(c => c.id === 'c1')!.name
    s = reducer(s, { t: 'setCompanyNameDraft', value: '   ' })
    s = reducer(s, { t: 'saveCompanyName' })
    expect(s.data.companies.find(c => c.id === 'c1')!.name).toBe(original)
  })
  it('cancels a company rename without changing the name', () => {
    let s = reducer(boot(), { t: 'startRenameCompany', id: 'c1' })
    const original = s.data.companies.find(c => c.id === 'c1')!.name
    s = reducer(s, { t: 'setCompanyNameDraft', value: 'Should not stick' })
    s = reducer(s, { t: 'cancelRenameCompany' })
    expect(s.data.companies.find(c => c.id === 'c1')!.name).toBe(original)
    expect(s.ui.renamingCompanyId).toBeNull()
  })
  it('deletes a company and cascades its engagements', () => {
    let s = reducer(boot(), { t: 'requestDeleteCompany', id: 'c1' })
    expect(s.ui.confirmDeleteCompanyId).toBe('c1')
    s = reducer(s, { t: 'confirmDeleteCompany' })
    expect(s.data.companies.find(c => c.id === 'c1')).toBeUndefined()
    expect(s.ui.confirmDeleteCompanyId).toBeNull()
  })
  it('cancels a company delete without removing it', () => {
    let s = reducer(boot(), { t: 'requestDeleteCompany', id: 'c1' })
    s = reducer(s, { t: 'cancelDeleteCompany' })
    expect(s.data.companies.find(c => c.id === 'c1')).toBeDefined()
    expect(s.ui.confirmDeleteCompanyId).toBeNull()
  })
  it('clears the active company/view when deleting the currently open company', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    s = reducer(s, { t: 'requestDeleteCompany', id: 'c1' })
    s = reducer(s, { t: 'confirmDeleteCompany' })
    expect(s.ui.activeCompanyId).toBeNull()
    expect(s.ui.view).toBe('home')
  })
  it('deriveTitle takes the first six words, capitalized', () => {
    expect(deriveTitle('check conditional access policies in entra now')).toBe('Check conditional access policies in entra')
  })
  it('deriveTitle falls back to "New chat" for empty/punctuation input', () => {
    expect(deriveTitle('   ')).toBe('New chat')
    expect(deriveTitle('!!!')).toBe('New chat')
  })
  it('inferFocus matches a phase by its leading keyword, else stays unset', () => {
    const phases = [{ id: 'iam', label: 'IAM' }, { id: 'storage', label: 'Storage (S3)' }]
    expect(inferFocus('audit storage buckets', phases)).toBe('storage')
    expect(inferFocus('unrelated question', phases)).toBe('')
    expect(inferFocus('conduct a CIS benchmark review against this aws organisation', phases)).toBe('')
  })
  it('infers focus from the first message; title stays provisional pending the live call', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const engId = activeEngagement(s)!.id
    s = reducer(s, { t: 'createChat', engId })
    const chatId = activeChat(s)!.id
    s = reducer(s, { t: 'appendUserMessage', chatId, text: 'review iam roles for privilege escalation' })
    const chat = chatByGlobalId(s, chatId)!
    expect(chat.name).toBe('New chat')
    expect(chat.phaseId).toBe('iam')
  })
  it('setChatTitle sets the title on a still-provisional chat', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const engId = activeEngagement(s)!.id
    s = reducer(s, { t: 'createChat', engId })
    const chatId = activeChat(s)!.id
    s = reducer(s, { t: 'setChatTitle', chatId, title: 'Review IAM Privilege Escalation' })
    expect(chatByGlobalId(s, chatId)!.name).toBe('Review IAM Privilege Escalation')
  })
  it('setChatTitle does not override a chat the user already renamed', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    s = reducer(s, { t: 'startRename' })
    s = reducer(s, { t: 'setNameDraft', value: 'My audit' })
    s = reducer(s, { t: 'saveName' })
    const chatId = activeChat(s)!.id
    s = reducer(s, { t: 'setChatTitle', chatId, title: 'Some generated title' })
    expect(chatByGlobalId(s, chatId)!.name).toBe('My audit')
  })
})

describe('upsertFinding', () => {
  const seededChat = () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const chatId = activeChat(s)!.id
    return { s, chatId }
  }
  it('inserts a new finding by id', () => {
    const { s, chatId } = seededChat()
    const before = activeChat(s)!.findings.length
    const s2 = reducer(s, { t: 'upsertFinding', chatId, finding: mkFinding() })
    const fs = chatByGlobalId(s2, chatId)!.findings
    expect(fs).toHaveLength(before + 1)
    expect(fs.find(f => f.id === 'f1')!.verified).toBe(false)
  })
  it('replaces an existing finding in place when the id matches', () => {
    const { s, chatId } = seededChat()
    const s2 = reducer(s, { t: 'upsertFinding', chatId, finding: mkFinding() })
    const countAfterInsert = chatByGlobalId(s2, chatId)!.findings.length
    const s3 = reducer(s2, { t: 'upsertFinding', chatId, finding: mkFinding({ verified: true, evidence: [{ kind: 'code_block', host: 's3://acme', detail: 'ACL public-read' }] }) })
    const fs = chatByGlobalId(s3, chatId)!.findings
    expect(fs).toHaveLength(countAfterInsert)          // no duplicate
    expect(fs.find(f => f.id === 'f1')!.verified).toBe(true)
    expect(fs.find(f => f.id === 'f1')!.evidence).toHaveLength(1)
  })
})

describe('m3a streaming reducer actions', () => {
  it('appendTextDelta creates an assistant message then appends to it', () => {
    let s = boot()
    const id = s.data.companies[0].engagements[0].chats[0].id
    const startCount = chatByGlobalId(s, id)!.messages.length
    s = reducer(s, { t: 'appendUserMessage', chatId: id, text: 'hello' })
    s = reducer(s, { t: 'appendTextDelta', chatId: id, delta: 'Hel' })
    s = reducer(s, { t: 'appendTextDelta', chatId: id, delta: 'lo' })
    const msgs = chatByGlobalId(s, id)!.messages
    const last = msgs[msgs.length - 1]
    expect(last.role).toBe('assistant')
    expect(last.content).toBe('Hello')
    // exactly one assistant message added for the two deltas (+1 user)
    expect(msgs.length).toBe(startCount + 2)
  })
  it('appendTextDelta does not mutate the previous state (reducer purity)', () => {
    let s = boot()
    const id = s.data.companies[0].engagements[0].chats[0].id
    s = reducer(s, { t: 'appendUserMessage', chatId: id, text: 'hi' })
    const s1 = reducer(s, { t: 'appendTextDelta', chatId: id, delta: 'Hel' })
    const s1msgs = chatByGlobalId(s1, id)!.messages
    const s1last = s1msgs[s1msgs.length - 1]
    expect(s1last.content).toBe('Hel')
    const s2 = reducer(s1, { t: 'appendTextDelta', chatId: id, delta: 'lo' })
    // dispatching on s1 must NOT have retroactively changed s1's message object
    expect(s1last.content).toBe('Hel')
    const s2msgs = chatByGlobalId(s2, id)!.messages
    expect(s2msgs[s2msgs.length - 1].content).toBe('Hello')
  })
  it('appendError pushes an assistant message prefixed with a warning glyph', () => {
    let s = boot()
    const id = s.data.companies[0].engagements[0].chats[0].id
    s = reducer(s, { t: 'appendError', chatId: id, message: 'boom' })
    const msgs = chatByGlobalId(s, id)!.messages
    expect(msgs[msgs.length - 1].content).toBe('⚠ boom')
    expect(msgs[msgs.length - 1].role).toBe('assistant')
  })
  it('setStreaming toggles per-chat busy state', () => {
    let s = boot()
    const id = s.data.companies[0].engagements[0].chats[0].id
    s = reducer(s, { t: 'setStreaming', chatId: id, on: true })
    expect(s.ui.streamingChats[id]).toBe(true)
    s = reducer(s, { t: 'setStreaming', chatId: id, on: false })
    expect(s.ui.streamingChats[id]).toBeUndefined()
  })
})

describe('reducer — request cards (M3d)', () => {
  it('appendInputRequest pushes an inputs request message', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const chatId = activeEngagement(s)!.chats[0].id
    const items = [{ key: 'AWS_ACCESS_KEY_ID', label: 'AWS access key', sensitive: true, required: true }]
    s = reducer(s, { t: 'appendInputRequest', chatId, requestId: 'r1', items })
    const msgs = chatByGlobalId(s, chatId)!.messages
    const msg = msgs[msgs.length - 1]
    expect(msg.kind).toBe('request')
    expect(msg.requestKind).toBe('inputs')
    expect(msg.requestId).toBe('r1')
    expect(msg.items).toEqual(items)
  })

  it('appendScopeRequest pushes a scope request message', () => {
    let s = reducer(boot(), { t: 'openCompany', id: 'c1' })
    const chatId = activeEngagement(s)!.chats[0].id
    s = reducer(s, { t: 'appendScopeRequest', chatId, engagementId: 'e1' })
    const msgs = chatByGlobalId(s, chatId)!.messages
    const msg = msgs[msgs.length - 1]
    expect(msg.kind).toBe('request')
    expect(msg.requestKind).toBe('scope')
    expect(msg.engagementId).toBe('e1')
  })
})
