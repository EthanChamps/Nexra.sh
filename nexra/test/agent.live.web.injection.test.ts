import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// No installed electron binary on this box — stub the safeStorage chain.
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s, 'utf8'), decryptString: (b: Buffer) => b.toString('utf8') } }))

// Shared state referenced inside the hoisted mock factories.
const h = vi.hoisted(() => ({ spawnCalls: [] as any[], decideWebAction: undefined as any }))
h.decideWebAction = vi.fn()

vi.mock('../electron/services/agent.decide', () => ({ decideWebAction: (...a: any[]) => h.decideWebAction(...a), defaultGenerate: () => async () => ({ text: '{}' }) }))

// Use the REAL runSkill (so the real scope gate runs) but inject a fake spawn so
// we can assert it is NEVER reached for an out-of-scope target.
vi.mock('../electron/services/agent.tools', async (orig) => {
  const real = await orig<any>()
  return { ...real, runSkill: (inv: any, def: any, emit: any, deps: any, id: string) =>
    real.runSkill(inv, def, emit, { ...deps, spawn: (...a: any[]) => {
      h.spawnCalls.push(a)
      const c: any = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter()
      queueMicrotask(() => c.emit('close', 0)); return c
    } }, id) }
})

import { runSend } from '../electron/services/agent.live'
import { setScope } from '../electron/services/scope'
import { initSettingsDb, closeDb } from '../electron/services/store.sqlite'
import type { AgentEvent, AgentSendRequest } from '../electron/services/agent.types'

const cfg = { provider: 'ollama' as const, model: 'gemma3:27b' }

describe('web scope + injection containment', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-inj-')); initSettingsDb(join(dir, 'nexra.db')); h.spawnCalls.length = 0; h.decideWebAction.mockReset() })
  afterEach(() => { closeDb(); rmSync(dir, { recursive: true, force: true }) })

  it('denies an out-of-scope URL the model proposes and never spawns docker', async () => {
    setScope('e1', { mode: 'allowlist', accounts: [], regions: [], hosts: ['app.acme.com'], wildcards: [], urlPrefixes: [], exclusions: [] })
    h.decideWebAction
      .mockResolvedValueOnce({ action: 'web_scan', url: 'https://evil.attacker.com/steal' })
      .mockResolvedValueOnce({ action: 'checkpoint' })
    const req: AgentSendRequest = { chatId: 'c1', engagementType: 'web', phaseLabel: 'Scan', text: 'go', history: [], companyId: 'co1', engagementId: 'e1' }
    const events: AgentEvent[] = []
    await runSend(req, cfg, e => events.push(e), new AbortController().signal, 'co1', 'e1')
    expect(h.spawnCalls.length).toBe(0)                                   // never spawned
    expect(events.some(e => e.type === 'skill' && (e as any).state === 'denied')).toBe(true)
  })
})
