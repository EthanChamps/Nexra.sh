import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'

const streamText = vi.fn()
vi.mock('ai', () => ({ streamText: (o: any) => streamText(o) }))
vi.mock('../electron/services/providers', () => ({ resolveModel: () => ({ tag: 'fake-model' }) }))

const state = { available: true }
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => state.available,
    encryptString: (s: string) => Buffer.from('enc:' + s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, ''),
  },
}))

// Fake spawn: intercepts the pwsh ScubaGear wrapper invocation and reports a
// scripted finding instead of actually shelling out. Never called for the
// out-of-scope case (asserted below) since runSkill denies before spawning.
const spawnSpy = vi.fn((_command: string, _args: string[], _options: any) => {
  const child: any = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  process.nextTick(() => {
    child.stdout.emit('data', Buffer.from('Legacy authentication protocols are enabled for contoso.onmicrosoft.com'))
    child.emit('close', 0)
  })
  return child
})
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: (...a: any[]) => (spawnSpy as any)(...a) }
})

import { initSettingsDb } from '../electron/services/store.sqlite'
import { createSecret, fillSecret } from '../electron/services/secrets.vault'
import { setScope } from '../electron/services/scope'
import { runSend } from '../electron/services/agent.live'
import type { AgentEvent, AgentSendRequest } from '../electron/services/agent.types'
import type { ProviderConfig } from '../electron/services/providers'

const cfg: ProviderConfig = { provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'sk-1' }

function fakeStream(parts: string[]) {
  return { textStream: (async function* () { for (const p of parts) yield p })(), usage: Promise.resolve({ totalTokens: 3 }) }
}

let dir: string
beforeEach(() => {
  state.available = true
  spawnSpy.mockClear()
  streamText.mockReset()
  dir = mkdtempSync(join(tmpdir(), 'nexra-m365-int-'))
  initSettingsDb(join(dir, 'nexra.db'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('M365 vertical end-to-end', () => {
  it('runs ScubaGear in-scope and logs a verified finding', async () => {
    setScope('e1', { mode: 'allowlist', accounts: [], regions: [], tenants: ['contoso.onmicrosoft.com'] })
    const secret = createSecret({
      companyId: 'c1', name: 'm365',
      fields: [{ envVar: 'M365_TENANT_ID' }, { envVar: 'M365_APP_ID' }, { envVar: 'M365_CERT' }],
      createdBy: 'operator',
    })
    fillSecret(secret.id, { M365_TENANT_ID: 'contoso.onmicrosoft.com', M365_APP_ID: 'app-1', M365_CERT: 'cert-1' })

    // Turn 1: model calls run_scubagear. Turn 2: after seeing the skill id in
    // the tool-result message, references it as tool_output=<id> so the
    // finding it logs resolves against the run registry and comes back
    // verified. This mirrors agent.live.findings.test.ts's evidence wiring.
    streamText.mockImplementationOnce(() => fakeStream(['SKILL_CALL[run_scubagear|tenant=contoso.onmicrosoft.com]']))
    streamText.mockImplementationOnce((opts: any) => {
      const toolMsg = opts.messages[opts.messages.length - 1].content as string
      const match = /reference its output with tool_output=([a-f0-9-]+)/.exec(toolMsg)
      const skillId = match ? match[1] : 'unknown'
      return fakeStream([`SKILL_CALL[log_finding|title=Legacy auth enabled|sev=High|tool_output=${skillId}]`])
    })
    streamText.mockImplementationOnce(() => fakeStream(['Done.']))

    const req: AgentSendRequest = { chatId: 'chat-1', engagementType: 'm365', phaseLabel: 'M365 Config Review', text: 'audit tenant', history: [] }
    const events: AgentEvent[] = []
    await runSend(req, cfg, e => events.push(e), new AbortController().signal, 'c1', 'e1')

    const skill = events.find(e => e.type === 'skill' && (e as any).skill === 'run_scubagear')
    expect(skill).toBeTruthy()
    expect(events.some(e => e.type === 'skill' && (e as any).state === 'denied')).toBe(false)
    expect(spawnSpy).toHaveBeenCalled()

    const finding = events.find(e => e.type === 'finding') as any
    expect(finding).toBeTruthy()
    expect(finding.verified).toBe(true)
  })

  it('denies ScubaGear against an out-of-scope tenant, never spawning', async () => {
    setScope('e1', { mode: 'allowlist', accounts: [], regions: [], tenants: ['contoso.onmicrosoft.com'] })
    const secret = createSecret({
      companyId: 'c1', name: 'm365',
      fields: [{ envVar: 'M365_TENANT_ID' }, { envVar: 'M365_APP_ID' }, { envVar: 'M365_CERT' }],
      createdBy: 'operator',
    })
    fillSecret(secret.id, { M365_TENANT_ID: 'contoso.onmicrosoft.com', M365_APP_ID: 'app-1', M365_CERT: 'cert-1' })

    streamText.mockImplementationOnce(() => fakeStream(['SKILL_CALL[run_scubagear|tenant=evil.onmicrosoft.com]']))
    streamText.mockImplementationOnce(() => fakeStream(['Understood.']))

    const req: AgentSendRequest = { chatId: 'chat-1', engagementType: 'm365', phaseLabel: 'M365 Config Review', text: 'audit tenant', history: [] }
    const events: AgentEvent[] = []
    await runSend(req, cfg, e => events.push(e), new AbortController().signal, 'c1', 'e1')

    expect(events.some(e => e.type === 'skill' && (e as any).state === 'denied')).toBe(true)
    expect(events.some(e => e.type === 'skill' && (e as any).state === 'success')).toBe(false)
    expect(spawnSpy).not.toHaveBeenCalled()
  })
})
