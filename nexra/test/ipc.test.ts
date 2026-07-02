import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sendMessage, cancelStream } from '../src/ipc'
import type { AgentEvent } from '../electron/services/agent.types'
import type { Chat, Engagement } from '../electron/services/store.types'

const chat = { id: 'c1', name: 'New chat', phaseId: '', color: '#000', tools: [{ name: 'prowler', available: true }],
  messages: [{ id: 'g', role: 'assistant', kind: 'text', content: 'greeting' }], findings: [] } as unknown as Chat
const eng = { type: 'aws', phases: [] } as unknown as Engagement

let sent: { req: any; onEvent: (e: AgentEvent) => void } | null
beforeEach(() => {
  sent = null
  ;(globalThis as any).window = { nexra: {
    agent: {
      send: (req: any, onEvent: any) => { sent = { req, onEvent }; return Promise.resolve() },
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
})

describe('cancelStream', () => {
  it('calls agent.cancel', () => {
    cancelStream('c1')
    expect((window as any).nexra.agent.cancel).toHaveBeenCalledWith('c1')
  })
})
