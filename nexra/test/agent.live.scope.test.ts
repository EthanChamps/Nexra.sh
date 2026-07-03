import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const streamText = vi.fn()
vi.mock('ai', () => ({ streamText: (o: any) => streamText(o) }))
vi.mock('../electron/services/providers', () => ({ resolveModel: () => ({ tag: 'fake-model' }) }))

import { initSettingsDb } from '../electron/services/store.sqlite'
import { runSend } from '../electron/services/agent.live'
import type { AgentEvent, AgentSendRequest } from '../electron/services/agent.types'
import type { ProviderConfig } from '../electron/services/providers'

const fakeStream = (parts: string[]) => ({ textStream: (async function* () { for (const p of parts) yield p })(), usage: Promise.resolve({ totalTokens: 1 }) })
const req: AgentSendRequest = { chatId: 'chat-1', engagementType: 'external', phaseLabel: 'Recon', text: 'recon', history: [] }
const cfg: ProviderConfig = { provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'sk-1' }

let dir: string
beforeEach(() => { streamText.mockReset(); dir = mkdtempSync(join(tmpdir(), 'nexra-alscope-')); initSettingsDb(join(dir, 'nexra.db')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('propose_scope_item', () => {
  it('emits a scope_proposal and pauses the turn (no second model step)', async () => {
    streamText.mockReturnValueOnce(fakeStream(['Found a new host. SKILL_CALL[propose_scope_item|type=hostname|value=admin.acme.com|reason=discovered in DNS]']))
    const events: AgentEvent[] = []
    await runSend(req, cfg, e => events.push(e), new AbortController().signal, 'co-1', 'eng-1')

    const proposal = events.find(e => e.type === 'scope_proposal') as any
    expect(proposal).toBeTruthy()
    expect(proposal.item).toEqual({ type: 'hostname', value: 'admin.acme.com' })
    expect(proposal.companyId).toBe('co-1')
    expect(streamText).toHaveBeenCalledTimes(1)   // paused, did not continue
  })
})
