import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

// The real run_scubagear skill shells out to `pwsh` running the ScubaGear
// PowerShell wrapper — not available (and not hermetic) in a unit run. We keep
// the ENTIRE production skill pipeline (scope gate, credential gate, real
// spawn, stdout capture into the run registry, success/denied events) and only
// swap the concrete command to a deterministic node one-liner that prints a
// finding-shaped line and exits 0 — exactly how the existing `probe`
// special-case and agent.tools.test.ts stand in for a real tool with
// process.execPath. Everything under test (tenant scope enforcement,
// credential injection gating, verified-finding wiring) is genuine production
// code. A module-path mock (unlike a node-builtin mock) reaches agent.tools
// inside runSend's own module graph, which a `node:child_process` mock does not.
const SCUBA_OUTPUT = 'ScubaGear: Legacy authentication protocols are ENABLED for contoso.onmicrosoft.com'
vi.mock('../electron/services/agent.tools', async importActual => {
  const actual = await importActual<typeof import('../electron/services/agent.tools')>()
  const fakeScuba = {
    ...actual.M365_SKILLS.run_scubagear,
    build: () => ({ command: process.execPath, args: ['-e', `process.stdout.write(${JSON.stringify(SCUBA_OUTPUT)})`] }),
  }
  return {
    ...actual,
    M365_SKILLS: { run_scubagear: fakeScuba },
    skillsForEngagement: (type: string) => (type === 'm365' ? { run_scubagear: fakeScuba } : actual.skillsForEngagement(type)),
  }
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

function seedM365Secret() {
  const secret = createSecret({
    companyId: 'c1', name: 'm365',
    fields: [{ envVar: 'M365_TENANT_ID' }, { envVar: 'M365_APP_ID' }, { envVar: 'M365_CERT' }],
    createdBy: 'operator',
  })
  fillSecret(secret.id, { M365_TENANT_ID: 'contoso.onmicrosoft.com', M365_APP_ID: 'app-1', M365_CERT: 'cert-1' })
}

let dir: string
beforeEach(() => {
  state.available = true
  streamText.mockReset()
  dir = mkdtempSync(join(tmpdir(), 'nexra-m365-int-'))
  initSettingsDb(join(dir, 'nexra.db'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('M365 vertical end-to-end', () => {
  it('runs ScubaGear in-scope and logs a verified finding', async () => {
    setScope('e1', { mode: 'allowlist', accounts: [], regions: [], tenants: ['contoso.onmicrosoft.com'] })
    seedM365Secret()

    // Turn 1: model calls run_scubagear against the in-scope tenant. Turn 2:
    // after runSend feeds back "reference its output with tool_output=<id>",
    // the model logs a finding citing that id, so evidenceFromArgs resolves the
    // captured stdout from the run registry and the finding comes back
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
    expect(events.some(e => e.type === 'skill' && (e as any).state === 'success')).toBe(true)

    const finding = events.find(e => e.type === 'finding') as any
    expect(finding).toBeTruthy()
    expect(finding.verified).toBe(true)
  })

  it('denies ScubaGear against an out-of-scope tenant, never spawning', async () => {
    setScope('e1', { mode: 'allowlist', accounts: [], regions: [], tenants: ['contoso.onmicrosoft.com'] })
    seedM365Secret()

    streamText.mockImplementationOnce(() => fakeStream(['SKILL_CALL[run_scubagear|tenant=evil.onmicrosoft.com]']))
    streamText.mockImplementationOnce(() => fakeStream(['Understood.']))

    const req: AgentSendRequest = { chatId: 'chat-1', engagementType: 'm365', phaseLabel: 'M365 Config Review', text: 'audit tenant', history: [] }
    const events: AgentEvent[] = []
    await runSend(req, cfg, e => events.push(e), new AbortController().signal, 'c1', 'e1')

    expect(events.some(e => e.type === 'skill' && (e as any).state === 'denied')).toBe(true)
    // Never spawned: the tenant-scope gate short-circuits before any child
    // runs, so there is no running/output/success event for the skill.
    expect(events.some(e => e.type === 'skill' && (e as any).state === 'success')).toBe(false)
    expect(events.some(e => e.type === 'skill' && (e as any).state === 'running')).toBe(false)
  })
})
