import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, initSettingsDb } from '../electron/services/store.sqlite'
import { createSecret, fillSecret } from '../electron/services/secrets.vault'
import { setScope } from '../electron/services/scope'
import type { AgentEvent } from '../electron/services/agent.types'
import { runSkill, type RunDeps } from '../electron/services/agent.tools'

const state = { available: true }
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => state.available,
    encryptString: (s: string) => Buffer.from('enc:' + s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, ''),
  },
}))

let dir: string
beforeEach(() => {
  state.available = true
  dir = mkdtempSync(join(tmpdir(), 'nexra-m3b-int-'))
  initSettingsDb(join(dir, 'nexra.db'))
})
afterEach(() => { closeDb(); rmSync(dir, { recursive: true, force: true }) })

describe('M3b end-to-end', () => {
  it('blocks a skill awaiting a secret, then runs after fulfillment', async () => {
    const events: AgentEvent[] = []
    const emit = (e: AgentEvent) => events.push(e)

    // Set up engagement with scope
    setScope('eng-1', { mode: 'all', accounts: [], regions: [] })

    // Define a skill that needs 'aws' credential
    const skillDef = {
      name: 'probe',
      requiredEnvVars: ['AWS_SECRET_ACCESS_KEY'],
      build: () => ({ command: process.execPath, args: ['-e', `process.stdout.write('CRED_PRESENT')`] }),
    }

    // First invocation: no secret filled yet
    const deps1: RunDeps = {
      getScope: () => ({ mode: 'all', accounts: [], regions: [] }),
      injectEnv: () => ({}),
      filledEnvVars: () => [],
    }
    const result1 = await runSkill(
      { skill: 'probe', companyId: 'c-1', engagementId: 'eng-1', account: '111', region: 'us-east-1' },
      skillDef as any,
      emit,
      deps1,
    )
    expect(result1.state).toBe('blocked')
    expect(events.some(e => e.type === 'input_request')).toBe(true)

    // Create and fill the secret
    const secret = createSecret({ companyId: 'c-1', name: 'aws', fields: [{ envVar: 'AWS_SECRET_ACCESS_KEY' }], createdBy: 'operator' })
    fillSecret(secret.id, { AWS_SECRET_ACCESS_KEY: 'test-value' })

    // Second invocation: secret filled, skill should run
    events.length = 0
    const deps2: RunDeps = {
      getScope: () => ({ mode: 'all', accounts: [], regions: [] }),
      injectEnv: () => ({ AWS_SECRET_ACCESS_KEY: 'test-value' }),
      filledEnvVars: () => ['AWS_SECRET_ACCESS_KEY'],
    }
    const result2 = await runSkill(
      { skill: 'probe', companyId: 'c-1', engagementId: 'eng-1', account: '111', region: 'us-east-1' },
      skillDef as any,
      emit,
      deps2,
    )
    expect(result2.state).toBe('success')
    const outputEvent = events.find(e => e.type === 'skill' && (e as any).state === 'output')
    expect(outputEvent).toBeDefined()
  })
})
