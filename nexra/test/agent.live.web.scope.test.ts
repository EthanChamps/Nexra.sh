import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A web run with no usable scope must PROMPT for scope (scope_request) and stop —
// not loop into silent per-skill denials with no operator recourse. The gate is
// fail-closed below the LLM, so without this guard the run is a dead end.

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s, 'utf8'), decryptString: (b: Buffer) => b.toString('utf8') } }))

const decideWebAction = vi.fn()
vi.mock('../electron/services/agent.decide', () => ({ decideWebAction: (...a: any[]) => decideWebAction(...a), defaultGenerate: () => async () => ({ text: '{}' }) }))
vi.mock('../electron/services/providers', () => ({ resolveModel: () => ({ tag: 'fake' }) }))

const spawnInv: any[] = []
vi.mock('../electron/services/agent.tools', async (orig) => {
  const real = await orig<any>()
  return { ...real, runSkill: async (inv: any) => { spawnInv.push(inv); return { state: 'success', exitCode: 0 } } }
})

import { runSend } from '../electron/services/agent.live'
import { initSettingsDb, closeDb } from '../electron/services/store.sqlite'
import { setScope } from '../electron/services/scope'
import type { AgentEvent, AgentSendRequest } from '../electron/services/agent.types'

const cfg = { provider: 'ollama' as const, model: 'qwen3.5:9b' }
const req: AgentSendRequest = { chatId: 'c1', engagementType: 'web', phaseLabel: 'Scan', text: 'scan https://app.acme.com', history: [], companyId: 'co1', engagementId: 'e1' }

describe('runSend (web) — scope required', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nexra-webscope-'))
    initSettingsDb(join(dir, 'nexra.db'))
    spawnInv.length = 0
    decideWebAction.mockReset()
  })
  afterEach(() => { closeDb(); rmSync(dir, { recursive: true, force: true }) })

  it('emits a scope_request and spawns nothing when no web scope is set', async () => {
    const events: AgentEvent[] = []
    await runSend(req, cfg, e => events.push(e), new AbortController().signal, 'co1', 'e1')
    expect(events.some(e => e.type === 'scope_request' && (e as any).engagementType === 'web')).toBe(true)
    expect(decideWebAction).not.toHaveBeenCalled()
    expect(spawnInv.length).toBe(0)
  })

  it('proceeds to decide once a web scope with hosts is set', async () => {
    setScope('e1', { mode: 'allowlist', accounts: [], regions: [], hosts: ['app.acme.com'], wildcards: [], urlPrefixes: [], exclusions: [] })
    decideWebAction.mockResolvedValueOnce({ action: 'checkpoint', note: 'done' })
    const events: AgentEvent[] = []
    await runSend(req, cfg, e => events.push(e), new AbortController().signal, 'co1', 'e1')
    expect(events.some(e => e.type === 'scope_request')).toBe(false)
    expect(decideWebAction).toHaveBeenCalled()
  })
})
