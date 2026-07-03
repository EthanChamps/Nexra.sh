import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendMessage, cancelStream, rehydrateFindings } from '../src/ipc'
import type { AgentEvent } from '../electron/services/agent.types'
import type { Chat, Engagement, Finding } from '../electron/services/store.types'

const chat = { id: 'c1', name: 'New chat', phaseId: '', color: '#000', tools: [{ name: 'prowler', available: true }],
  messages: [{ id: 'g', role: 'assistant', kind: 'text', content: 'greeting' }], findings: [] } as unknown as Chat
const eng = { type: 'aws', phases: [] } as unknown as Engagement

let sent: { req: any; onEvent: (e: AgentEvent) => void } | null
let titleMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  sent = null
  titleMock = vi.fn(() => Promise.resolve('Untitled'))
  ;(globalThis as any).window = { nexra: {
    agent: {
      send: (req: any, onEvent: any) => { sent = { req, onEvent }; return Promise.resolve() },
      title: (req: any) => titleMock(req),
      cancel: vi.fn(() => Promise.resolve()),
    },
  } }
})

describe('sendMessage', () => {
  it('sends history built from prior messages and starts streaming', () => {
    const dispatched: any[] = []
    sendMessage((a: any) => dispatched.push(a), chat, eng, 'hello there')
    expect(dispatched).toContainEqual({ t: 'appendUserMessage', chatId: 'c1', text: 'hello there' })
    expect(dispatched).toContainEqual({ t: 'setStreaming', chatId: 'c1', on: true })
    expect(sent!.req.history).toEqual([{ role: 'assistant', content: 'greeting' }])
    expect(sent!.req.text).toBe('hello there')
  })
  it('includes companyId and engagementId in the request so the agent loop can run skills', () => {
    const engWithId = { type: 'aws', id: 'eng-9', phases: [] } as unknown as Engagement
    sendMessage(() => {}, chat, engWithId, 'audit', 'co-42')
    expect(sent!.req.companyId).toBe('co-42')
    expect(sent!.req.engagementId).toBe('eng-9')
  })
  it('maps text_delta/done into reducer actions and clears streaming on done', () => {
    const dispatched: any[] = []
    sendMessage((a: any) => dispatched.push(a), chat, eng, 'hi')
    sent!.onEvent({ type: 'text_delta', delta: 'yo' })
    sent!.onEvent({ type: 'done' })
    expect(dispatched).toContainEqual({ t: 'appendTextDelta', chatId: 'c1', delta: 'yo' })
    expect(dispatched).toContainEqual({ t: 'setStreaming', chatId: 'c1', on: false })
  })
  it('maps error into appendError and clears streaming', () => {
    const dispatched: any[] = []
    sendMessage((a: any) => dispatched.push(a), chat, eng, 'hi')
    sent!.onEvent({ type: 'error', message: '401' })
    expect(dispatched).toContainEqual({ t: 'appendError', chatId: 'c1', message: '401' })
    expect(dispatched).toContainEqual({ t: 'setStreaming', chatId: 'c1', on: false })
  })
  it('clears streaming and surfaces an error if agent.send rejects', async () => {
    ;(window as any).nexra.agent.send = () => Promise.reject(new Error('boom'))
    const dispatched: any[] = []
    sendMessage((a: any) => dispatched.push(a), chat, eng, 'hi')
    await Promise.resolve()
    expect(dispatched).toContainEqual({ t: 'appendError', chatId: 'c1', message: 'boom' })
    expect(dispatched).toContainEqual({ t: 'setStreaming', chatId: 'c1', on: false })
  })
  it('fires agent.title on the first user message of a provisional chat', () => {
    titleMock.mockResolvedValue('Review IAM Roles')
    const dispatched: any[] = []
    sendMessage((a: any) => dispatched.push(a), chat, eng, 'review iam roles')
    expect(titleMock).toHaveBeenCalledWith({ engagementType: 'aws', text: 'review iam roles' })
  })
  it('dispatches setChatTitle with the resolved title on success', async () => {
    titleMock.mockResolvedValue('Review IAM Roles')
    const dispatched: any[] = []
    sendMessage((a: any) => dispatched.push(a), chat, eng, 'review iam roles')
    await vi.waitFor(() => {
      expect(dispatched).toContainEqual({ t: 'setChatTitle', chatId: 'c1', title: 'Review IAM Roles' })
    })
  })
  it('falls back to deriveTitle when the title call rejects', async () => {
    titleMock.mockRejectedValue(new Error('no api key'))
    const dispatched: any[] = []
    sendMessage((a: any) => dispatched.push(a), chat, eng, 'look at storage buckets')
    await vi.waitFor(() => {
      expect(dispatched).toContainEqual({ t: 'setChatTitle', chatId: 'c1', title: 'Look at storage buckets' })
    })
  })
  it('does not fire agent.title on a chat the user already renamed', () => {
    const dispatched: any[] = []
    sendMessage((a: any) => dispatched.push(a), { ...chat, name: 'My audit' }, eng, 'hello')
    expect(titleMock).not.toHaveBeenCalled()
  })
  it('does not fire agent.title on a second message', () => {
    const dispatched: any[] = []
    const secondChat = {
      ...chat,
      messages: [
        { id: 'g', role: 'assistant', kind: 'text', content: 'greeting' },
        { id: 'u1', role: 'user', kind: 'text', content: 'first' },
        { id: 'a1', role: 'assistant', kind: 'text', content: 'reply' },
      ],
    } as unknown as Chat
    sendMessage((a: any) => dispatched.push(a), secondChat, eng, 'second message')
    expect(titleMock).not.toHaveBeenCalled()
  })
  it('maps input_request / scope_request / skill events into reducer actions', () => {
    const dispatched: any[] = []
    sendMessage((a: any) => dispatched.push(a), chat, eng, 'hi')
    const items = [{ key: 'AWS_ACCESS_KEY_ID', label: 'AWS access key', sensitive: true, required: true }]
    sent!.onEvent({ type: 'input_request', requestId: 'r1', items })
    sent!.onEvent({ type: 'scope_request', engagementId: 'e1' })
    sent!.onEvent({ type: 'skill', id: 'sk1', skill: 'run_prowler', state: 'running' })
    expect(dispatched).toContainEqual({ t: 'appendInputRequest', chatId: 'c1', requestId: 'r1', items })
    expect(dispatched).toContainEqual({ t: 'appendScopeRequest', chatId: 'c1', engagementId: 'e1' })
    expect(dispatched).toContainEqual({ t: 'appendSkillEvent', chatId: 'c1', skillEvent: { type: 'skill', id: 'sk1', skill: 'run_prowler', state: 'running' } })
  })
})

describe('rehydrateFindings', () => {
  it('lists findings per chat and dispatches an upsert for each', async () => {
    const persisted: Record<string, Finding[]> = {
      chA: [{ id: 'f1', title: 'x', sev: 'High', phase: 'IAM', time: 'now', rationale: 'r', evidence: [], verified: false }],
      chB: [],
    }
    ;(globalThis as any).window.nexra.findings = { list: (id: string) => Promise.resolve(persisted[id] ?? []) }
    const data = { companies: [{ id: 'c1', name: 'Acme', updated: '', engagements: [
      { id: 'e1', type: 'aws', name: 'E', status: 'In Progress', updated: '', linear: true, phases: [], scope: [], chats: [
        { id: 'chA', name: 'A', phaseId: '', color: '#000', messages: [], findings: [], tools: [] },
        { id: 'chB', name: 'B', phaseId: '', color: '#000', messages: [], findings: [], tools: [] },
      ] },
    ] }], types: {} } as any
    const dispatched: any[] = []
    rehydrateFindings((a: any) => dispatched.push(a), data)
    await new Promise(r => setTimeout(r, 0))
    expect(dispatched).toContainEqual({ t: 'upsertFinding', chatId: 'chA', finding: persisted.chA[0] })
    expect(dispatched.filter(a => a.chatId === 'chB')).toHaveLength(0)
  })
})

describe('cancelStream', () => {
  it('calls agent.cancel and immediately clears busy state, without waiting on the IPC round trip', () => {
    const dispatched: any[] = []
    cancelStream((a: any) => dispatched.push(a), 'c1')
    expect((window as any).nexra.agent.cancel).toHaveBeenCalledWith('c1')
    expect(dispatched).toContainEqual({ t: 'setStreaming', chatId: 'c1', on: false })
  })
})
