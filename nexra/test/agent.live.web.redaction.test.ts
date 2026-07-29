import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Proves the de-identification wiring in runWebSend: the model never receives a
// real hostname, yet skills still spawn against the real target.

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s, 'utf8'), decryptString: (b: Buffer) => b.toString('utf8') } }))

const decideWebAction = vi.fn()
vi.mock('../electron/services/agent.decide', () => ({ decideWebAction: (...a: any[]) => decideWebAction(...a), defaultGenerate: () => async () => ({ text: '{}' }) }))
vi.mock('../electron/services/providers', () => ({ resolveModel: () => ({ tag: 'fake' }) }))

// Capture the invocation runSkill receives so we can assert the URL was resolved
// back to the real host before spawn. Emits a nuclei line that mentions the real
// host, so we can prove the summary fed back on the next turn is masked.
const spawnInv: any[] = []
vi.mock('../electron/services/agent.tools', async (orig) => {
  const real = await orig<any>()
  return { ...real, runSkill: async (inv: any, def: any, emit: any, _d: any, id: string) => {
    spawnInv.push(inv)
    emit({ type: 'skill', id, skill: def.name, state: 'output', chunk: JSON.stringify({ 'template-id': 'git-config', info: { name: 'Exposed .git', severity: 'critical' }, host: 'app.acme.com', 'matched-at': 'https://app.acme.com/.git/config' }) })
    emit({ type: 'skill', id, skill: def.name, state: 'success' })
    return { state: 'success', exitCode: 0 }
  } }
})

import { runSend } from '../electron/services/agent.live'
import { initSettingsDb, closeDb } from '../electron/services/store.sqlite'
import { setScope } from '../electron/services/scope'
import type { AgentEvent, AgentSendRequest } from '../electron/services/agent.types'

const cfg = { provider: 'ollama' as const, model: 'gemma3:27b' }
const req: AgentSendRequest = { chatId: 'c1', engagementType: 'web', phaseLabel: 'Scan', text: 'scan https://app.acme.com', history: [], companyId: 'co1', engagementId: 'e1' }

describe('runSend (web) — de-identification', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nexra-webredact-'))
    initSettingsDb(join(dir, 'nexra.db'))
    setScope('e1', { mode: 'allowlist', accounts: [], regions: [], hosts: ['app.acme.com'], wildcards: [], urlPrefixes: [], exclusions: [] })
    spawnInv.length = 0
  })
  afterEach(() => { closeDb(); rmSync(dir, { recursive: true, force: true }) })

  it('masks the host to the model but spawns skills against the real target', async () => {
    decideWebAction.mockReset()
    // Scope seeds app.acme.com -> h1.masked.local, so the model returns the handle.
    decideWebAction
      .mockResolvedValueOnce({ action: 'web_scan', url: 'https://h1.masked.local' })
      .mockResolvedValueOnce({ action: 'checkpoint', note: 'done' })
    const events: AgentEvent[] = []
    await runSend(req, cfg, e => events.push(e), new AbortController().signal, 'co1', 'e1')

    // 1) The model's very first turn carried no real hostname.
    const firstMessages = decideWebAction.mock.calls[0][0].messages
    expect(JSON.stringify(firstMessages)).not.toContain('acme.com')
    expect(JSON.stringify(firstMessages)).toMatch(/masked\.local/)

    // 2) The skill was invoked against the RESOLVED real URL, not the handle.
    expect(spawnInv[0].url).toBe('https://app.acme.com')

    // 3) The tool summary fed back on the 2nd decision is de-identified.
    const secondMessages = decideWebAction.mock.calls[1][0].messages
    expect(JSON.stringify(secondMessages)).not.toContain('acme.com')

    // 4) The finding stored/emitted locally keeps the REAL host.
    expect(events.some(e => e.type === 'finding' && /app\.acme\.com/.test(JSON.stringify(e)))).toBe(true)
  })
})
