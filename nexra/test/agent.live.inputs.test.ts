import { describe, it, expect, vi, beforeEach } from 'vitest'

const streamText = vi.fn()
vi.mock('ai', () => ({ streamText: (o: any) => streamText(o) }))
vi.mock('../electron/services/providers', () => ({ resolveModel: () => ({ tag: 'fake-model' }) }))
vi.mock('../electron/services/store.sqlite', () => ({ upsertFinding: vi.fn() }))

import { runSend } from '../electron/services/agent.live'
import type { AgentEvent, AgentSendRequest } from '../electron/services/agent.types'
import type { ProviderConfig } from '../electron/services/providers'

const req: AgentSendRequest = { chatId: 'chat-1', engagementType: 'aws', phaseLabel: 'Recon', primaryTool: 'prowler', text: 'audit', history: [] }
const cfg: ProviderConfig = { provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'sk-1' }
const fakeStream = (parts: string[]) => ({ textStream: (async function* () { for (const p of parts) yield p })(), usage: Promise.resolve({ totalTokens: 1 }) })
beforeEach(() => streamText.mockReset())

describe('runSend request_inputs (M3d)', () => {
  it('emits one input_request from a request_inputs skill call and ends the turn', async () => {
    streamText.mockReturnValueOnce(fakeStream([
      'I need credentials. SKILL_CALL[request_inputs|items=AWS_ACCESS_KEY_ID:AWS access key:s:r;ORG_ID:Organization ID:-:r;REGION:Target region:-:-]',
    ]))
    const events: AgentEvent[] = []
    await runSend(req, cfg, e => events.push(e), new AbortController().signal)

    const reqEv = events.find(e => e.type === 'input_request') as any
    expect(reqEv).toBeTruthy()
    expect(reqEv.items).toEqual([
      { key: 'AWS_ACCESS_KEY_ID', label: 'AWS access key', sensitive: true, required: true },
      { key: 'ORG_ID', label: 'Organization ID', sensitive: false, required: true },
      { key: 'REGION', label: 'Target region', sensitive: false, required: false },
    ])
    // request halts the loop: streamText called exactly once, exactly one done
    expect(streamText.mock.calls.length).toBe(1)
    expect(events.filter(e => e.type === 'done')).toHaveLength(1)
  })
})
