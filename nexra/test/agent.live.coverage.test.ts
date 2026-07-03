import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const streamText = vi.fn()
vi.mock('ai', () => ({ streamText: (o: any) => streamText(o) }))
vi.mock('../electron/services/providers', () => ({ resolveModel: () => ({ tag: 'fake-model' }) }))

import { initSettingsDb } from '../electron/services/store.sqlite'
import { setScope } from '../electron/services/scope'
import { listPhaseCoverage } from '../electron/services/store.memory'
import { runSend } from '../electron/services/agent.live'
import type { AgentEvent, AgentSendRequest } from '../electron/services/agent.types'
import type { ProviderConfig } from '../electron/services/providers'

const fakeStream = (parts: string[]) => ({ textStream: (async function* () { for (const p of parts) yield p })(), usage: Promise.resolve({ totalTokens: 1 }) })

const req: AgentSendRequest = {
  chatId: 'chat-1', engagementType: 'aws', phaseLabel: 'IAM',
  text: 'enumerate iam', history: [],
}
const cfg: ProviderConfig = { provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'sk-1' }

let dir: string
beforeEach(() => {
  streamText.mockReset()
  dir = mkdtempSync(join(tmpdir(), 'nexra-cov-'))
  initSettingsDb(join(dir, 'nexra.db'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('runSend marks phase coverage on a skill run (M4)', () => {
  it('marks the requested phase in_progress after a skill runs for an engagement', async () => {
    setScope('eng-1', { mode: 'all', accounts: [], regions: [] })
    streamText
      .mockReturnValueOnce(fakeStream(['SKILL_CALL[probe|account=111111111111|region=us-east-1]']))
      .mockReturnValueOnce(fakeStream(['Done probing.']))
    const events: AgentEvent[] = []
    await runSend(req, cfg, e => events.push(e), new AbortController().signal, 'co-1', 'eng-1')

    expect(listPhaseCoverage('eng-1').find(p => p.phaseId === 'IAM')?.status).toBe('in_progress')
  })
})
