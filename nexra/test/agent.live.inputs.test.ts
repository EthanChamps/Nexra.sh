import { describe, it, expect, vi, beforeEach } from 'vitest'

const streamText = vi.fn()
vi.mock('ai', () => ({ streamText: (o: any) => streamText(o) }))
vi.mock('../electron/services/providers', () => ({ resolveModel: () => ({ tag: 'fake-model' }) }))
vi.mock('../electron/services/store.sqlite', () => ({ upsertFinding: vi.fn() }))

import { runSend } from '../electron/services/agent.live'
import type { AgentEvent, AgentSendRequest } from '../electron/services/agent.types'
import type { ProviderConfig } from '../electron/services/providers'

const req: AgentSendRequest = { chatId: 'chat-1', engagementType: 'aws', phaseLabel: 'Recon', text: 'audit', history: [] }
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

  // Regression: the model sometimes slips and writes the bracketless colon form
  // (SKILL_CALL:name|...) instead of SKILL_CALL[name|...]. The strict parser used
  // to drop it silently, ending the turn with no input_request card — the run
  // looked stuck asking for secrets it never actually requested.
  it('accepts the bracketless colon form of a request_inputs call', async () => {
    streamText.mockReturnValueOnce(fakeStream([
      'To begin the CIS scan I need connection details.\n' +
      'SKILL_CALL:request_inputs|items=AWS_ACCESS_KEY_ID:Access Key ID:s:r;AWS_SECRET_ACCESS_KEY:Secret Access Key:s:r;AWS_REGION:Target Region:-:r;AWS_ACCOUNT_ID:Account ID:-:r',
    ]))
    const events: AgentEvent[] = []
    await runSend(req, cfg, e => events.push(e), new AbortController().signal)

    const reqEv = events.find(e => e.type === 'input_request') as any
    expect(reqEv).toBeTruthy()
    expect(reqEv.items).toEqual([
      { key: 'AWS_ACCESS_KEY_ID', label: 'Access Key ID', sensitive: true, required: true },
      { key: 'AWS_SECRET_ACCESS_KEY', label: 'Secret Access Key', sensitive: true, required: true },
      { key: 'AWS_REGION', label: 'Target Region', sensitive: false, required: true },
      { key: 'AWS_ACCOUNT_ID', label: 'Account ID', sensitive: false, required: true },
    ])
    expect(streamText.mock.calls.length).toBe(1)
    expect(events.filter(e => e.type === 'done')).toHaveLength(1)
  })

  // Regression: a request_inputs whose items don't parse (missing/malformed
  // items arg) used to emit no card and no feedback — the run hung on
  // "Requesting inputs". Now the model is told the correct format and retries.
  it('feeds the format back (does not hang) when request_inputs parses to zero items', async () => {
    // Turn 1: malformed request_inputs (wrong arg, no items=). Turn 2: corrected.
    streamText.mockReturnValueOnce(fakeStream([
      'To proceed I need credentials. SKILL_CALL[request_inputs|fields=M365_TENANT_ID,M365_APP_ID,M365_CERT]',
    ]))
    streamText.mockReturnValueOnce(fakeStream([
      'SKILL_CALL[request_inputs|items=M365_TENANT_ID:Tenant domain:-:r;M365_APP_ID:App ID:-:r;M365_CERT:Certificate:s:r]',
    ]))
    const events: AgentEvent[] = []
    await runSend(req, cfg, e => events.push(e), new AbortController().signal)

    // The malformed call did NOT hang: the model was re-invoked (turn 2) and the
    // corrected call produced exactly one input_request card.
    expect(streamText.mock.calls.length).toBe(2)
    const reqEvents = events.filter(e => e.type === 'input_request')
    expect(reqEvents).toHaveLength(1)
    expect((reqEvents[0] as any).items.map((i: any) => i.key)).toEqual(['M365_TENANT_ID', 'M365_APP_ID', 'M365_CERT'])
    // The corrective feedback was sent back to the model on turn 2.
    const turn2 = streamText.mock.calls[1][0].messages.map((m: any) => m.content).join('\n')
    expect(turn2).toContain('request_inputs produced NO items')
  })
})
