import { describe, it, expect, vi, beforeEach } from 'vitest'

const streamText = vi.fn()
vi.mock('ai', () => ({ streamText: (o: any) => streamText(o) }))
vi.mock('../electron/services/providers', () => ({ resolveModel: () => ({ tag: 'fake-model' }) }))

import { runSend } from '../electron/services/agent.live'
import type { AgentEvent, AgentSendRequest } from '../electron/services/agent.types'
import type { ProviderConfig } from '../electron/services/providers'

const req: AgentSendRequest = { chatId: 'c1', engagementType: 'aws', phaseLabel: 'IAM', primaryTool: 'prowler', text: 'hi', history: [] }
const cfg: ProviderConfig = { provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'sk-1' }

function fakeStream(parts: string[]) {
  return { textStream: (async function* () { for (const p of parts) yield p })(), usage: Promise.resolve({ totalTokens: 3 }) }
}

describe('runSend', () => {
  beforeEach(() => streamText.mockClear())

  it('emits a text_delta per chunk then done', async () => {
    streamText.mockReturnValue(fakeStream(['Hel', 'lo']))
    const events: AgentEvent[] = []
    await runSend(req, cfg, e => events.push(e), new AbortController().signal)
    expect(events).toEqual([
      { type: 'text_delta', delta: 'Hel' },
      { type: 'text_delta', delta: 'lo' },
      { type: 'done' },
    ])
  })
  it('emits error when the stream throws', async () => {
    streamText.mockReturnValue({ textStream: (async function* () { throw new Error('401 unauthorized') })(), usage: Promise.resolve({}) })
    const events: AgentEvent[] = []
    await runSend(req, cfg, e => events.push(e), new AbortController().signal)
    expect(events.some(e => e.type === 'error' && /401/.test(e.message))).toBe(true)
    expect(events.some(e => e.type === 'done')).toBe(false)
  })
  it('finalizes cleanly (done, no error) when aborted', async () => {
    const ctrl = new AbortController()
    streamText.mockReturnValue({ textStream: (async function* () { ctrl.abort(); throw Object.assign(new Error('aborted'), { name: 'AbortError' }) })(), usage: Promise.resolve({}) })
    const events: AgentEvent[] = []
    await runSend(req, cfg, e => events.push(e), ctrl.signal)
    expect(events.some(e => e.type === 'error')).toBe(false)
    expect(events[events.length - 1]).toEqual({ type: 'done' })
  })
  it('drops the leading assistant greeting but keeps real history', async () => {
    streamText.mockReturnValue(fakeStream(['ok']))
    const withHistory: AgentSendRequest = {
      ...req,
      text: 'second',
      history: [
        { role: 'assistant', content: 'greeting' },
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
      ],
    }
    await runSend(withHistory, cfg, () => {}, new AbortController().signal)
    expect(streamText.mock.calls[0][0].messages).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'second' },
    ])
  })
  it('sends only the current user turn when history is just a greeting', async () => {
    streamText.mockReturnValue(fakeStream(['ok']))
    const greetingOnly: AgentSendRequest = {
      ...req,
      text: 'hi',
      history: [{ role: 'assistant', content: 'greeting' }],
    }
    await runSend(greetingOnly, cfg, () => {}, new AbortController().signal)
    expect(streamText.mock.calls[0][0].messages).toEqual([
      { role: 'user', content: 'hi' },
    ])
  })
})
