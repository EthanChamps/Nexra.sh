import { describe, it, expect, vi, beforeEach } from 'vitest'
// No Electron runtime is needed for deterministic agent tests.
vi.mock('electron', () => ({ safeStorage: {} }))

const streamText = vi.fn()
vi.mock('ai', () => ({ streamText: (o: any) => streamText(o) }))
vi.mock('../electron/services/providers', () => ({ resolveModel: () => ({ tag: 'fake-model' }) }))
const upsertFinding = vi.fn()
vi.mock('../electron/services/store.sqlite', () => ({ upsertFinding: (...a: any[]) => upsertFinding(...a) }))

import { runSend } from '../electron/services/agent.live'
import type { AgentEvent, AgentSendRequest } from '../electron/services/agent.types'
import type { ProviderConfig } from '../electron/services/providers'

const req: AgentSendRequest = { chatId: 'chat-1', engagementType: 'aws', phaseLabel: 'Storage', text: 'audit s3', history: [] }
const cfg: ProviderConfig = { provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'sk-1' }
const fakeStream = (parts: string[]) => ({ textStream: (async function* () { for (const p of parts) yield p })(), usage: Promise.resolve({ totalTokens: 1 }) })

beforeEach(() => { streamText.mockReset(); upsertFinding.mockReset() })

describe('runSend finding loop', () => {
  it('logs an unverified finding, then verifies it after the agent attaches evidence', async () => {
    streamText
      .mockReturnValueOnce(fakeStream(['SKILL_CALL[log_finding|title=Public bucket|sev=High|phase=Storage|rationale=world-readable]']))
      .mockReturnValueOnce(fakeStream(['SKILL_CALL[attach_evidence|host=s3://acme|detail=ACL public-read]']))
      .mockReturnValueOnce(fakeStream(['All set.']))
    const events: AgentEvent[] = []
    await runSend(req, cfg, e => events.push(e), new AbortController().signal)

    const findings = events.filter(e => e.type === 'finding') as Extract<AgentEvent, { type: 'finding' }>[]
    expect(findings).toHaveLength(2)
    expect(findings[0].verified).toBe(false)
    expect(findings[1].verified).toBe(true)
    expect(findings[0].id).toBe(findings[1].id)                 // same finding, upserted
    expect(findings[1].evidence).toEqual([{ kind: 'code_block', host: 's3://acme', detail: 'ACL public-read' }])
    expect(findings[1].sev).toBe('High')
    // persisted both times, last write verified
    expect(upsertFinding).toHaveBeenCalledWith('chat-1', expect.objectContaining({ verified: true }))
    expect(events[events.length - 1]).toEqual({ type: 'done' })
  })

  it('still emits text_delta then done for a plain reply with no skill calls (loop is transparent)', async () => {
    streamText.mockReturnValueOnce(fakeStream(['Hel', 'lo']))
    const events: AgentEvent[] = []
    await runSend(req, cfg, e => events.push(e), new AbortController().signal)
    expect(events).toEqual([{ type: 'text_delta', delta: 'Hel' }, { type: 'text_delta', delta: 'lo' }, { type: 'done' }])
  })

  it('stops at STEP_CAP even if the model keeps emitting skill calls', async () => {
    // Fresh stream per call — an async generator is single-use, so mockReturnValue
    // would exhaust after turn 1 and the loop would break early.
    streamText.mockImplementation(() => fakeStream(['SKILL_CALL[log_finding|title=loop|sev=Low]']))
    const events: AgentEvent[] = []
    await runSend(req, cfg, e => events.push(e), new AbortController().signal)
    expect(streamText.mock.calls.length).toBeLessThanOrEqual(6)   // STEP_CAP
    expect(events[events.length - 1]).toEqual({ type: 'done' })
  })
})
