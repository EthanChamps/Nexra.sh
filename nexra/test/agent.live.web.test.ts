import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// This box has no installed electron binary; stub the safeStorage chain that
// secrets.ts imports so the module graph loads under the node test runner.
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s, 'utf8'), decryptString: (b: Buffer) => b.toString('utf8') } }))

// Fake the schema-constrained decision so we script the model's actions.
const decideWebAction = vi.fn()
vi.mock('../electron/services/agent.decide', () => ({ decideWebAction: (...a: any[]) => decideWebAction(...a), defaultGenerate: () => async () => ({ text: '{}' }) }))
vi.mock('../electron/services/providers', () => ({ resolveModel: () => ({ tag: 'fake' }) }))
// runSkill returns success and emits one output chunk of fake nuclei JSON.
vi.mock('../electron/services/agent.tools', async (orig) => {
  const real = await orig<any>()
  return { ...real, runSkill: async (_inv: any, def: any, emit: any, _d: any, id: string) => {
    emit({ type: 'skill', id, skill: def.name, state: 'output', chunk: JSON.stringify({ 'template-id': 'git-config', info: { name: 'Exposed .git', severity: 'critical' }, host: 'app.acme.com', 'matched-at': 'https://app.acme.com/.git/config' }) })
    emit({ type: 'skill', id, skill: def.name, state: 'success' })
    return { state: 'success', exitCode: 0 }
  } }
})

import { runSend } from '../electron/services/agent.live'
import { initSettingsDb, closeDb } from '../electron/services/store.sqlite'
import type { AgentEvent, AgentSendRequest } from '../electron/services/agent.types'

const cfg = { provider: 'ollama' as const, model: 'gemma3:27b' }
const req: AgentSendRequest = { chatId: 'c1', engagementType: 'web', phaseLabel: 'Scan', text: 'scan it', history: [], companyId: 'co1', engagementId: 'e1' }

describe('runSend (web)', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-webloop-')); initSettingsDb(join(dir, 'nexra.db')) })
  afterEach(() => { closeDb(); rmSync(dir, { recursive: true, force: true }) })

  it('runs the phase skill, pre-drafts a candidate finding, and checkpoints', async () => {
    decideWebAction.mockReset()
    decideWebAction
      .mockResolvedValueOnce({ action: 'web_scan', url: 'https://app.acme.com' })
      .mockResolvedValueOnce({ action: 'checkpoint', note: 'scan done' })
    const events: AgentEvent[] = []
    await runSend(req, cfg, e => events.push(e), new AbortController().signal, 'co1', 'e1')
    // a finding was pre-drafted from the parsed nuclei output
    expect(events.some(e => e.type === 'finding' && /\.git/i.test((e as any).title + ((e as any).evidence?.[0]?.detail ?? '')))).toBe(true)
    // a checkpoint was emitted and the run ended cleanly
    expect(events.some(e => e.type === 'checkpoint')).toBe(true)
    expect(events[events.length - 1]).toEqual({ type: 'done' })
  })
})
