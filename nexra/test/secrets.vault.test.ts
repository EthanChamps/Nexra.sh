import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const state = { available: true }
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => state.available,
    encryptString: (s: string) => Buffer.from('enc:' + s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, ''),
  },
}))

import { initSettingsDb } from '../electron/services/store.sqlite'
import { createSecret, fillSecret, tieSecret, listSecrets, deleteSecret, hasFilledSecret, injectEnv, filledEnvVars, upsertFilledInput } from '../electron/services/secrets.vault'

let dir: string
beforeEach(() => {
  state.available = true
  dir = mkdtempSync(join(tmpdir(), 'nexra-vault-'))
  initSettingsDb(join(dir, 'nexra.db'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const AWS = [{ envVar: 'AWS_ACCESS_KEY_ID' }, { envVar: 'AWS_SECRET_ACCESS_KEY' }]

describe('secrets.vault', () => {
  it('creates a pending slot, then fills it to injectable env', () => {
    const s = createSecret({ companyId: 'c1', name: 'aws-prod', fields: AWS, createdBy: 'operator' })
    expect(s.status).toBe('pending')
    expect(injectEnv('c1')).toEqual({})           // pending → not injected

    fillSecret(s.id, { AWS_ACCESS_KEY_ID: 'AKIA123', AWS_SECRET_ACCESS_KEY: 'shh-secret' })
    expect(injectEnv('c1')).toEqual({ AWS_ACCESS_KEY_ID: 'AKIA123', AWS_SECRET_ACCESS_KEY: 'shh-secret' })
  })

  it('never exposes a value through the metadata list', () => {
    const s = createSecret({ companyId: 'c1', name: 'aws-prod', fields: AWS, createdBy: 'operator' })
    fillSecret(s.id, { AWS_ACCESS_KEY_ID: 'AKIA123', AWS_SECRET_ACCESS_KEY: 'shh-secret' })
    const listed = JSON.stringify(listSecrets('c1'))
    expect(listed).not.toContain('shh-secret')
    expect(listed).not.toContain('AKIA123')
    expect(listed).toContain('aws-prod')          // name/metadata is fine
  })

  it('scopes secrets per company', () => {
    const a = createSecret({ companyId: 'clientA', name: 'aws', fields: AWS, createdBy: 'operator' })
    fillSecret(a.id, { AWS_ACCESS_KEY_ID: 'A', AWS_SECRET_ACCESS_KEY: 'a' })
    expect(injectEnv('clientA').AWS_ACCESS_KEY_ID).toBe('A')
    expect(injectEnv('clientB')).toEqual({})      // no bleed across clients
  })

  it('resolves a tie (alias) to the target secret value', () => {
    const shared = createSecret({ companyId: 'c1', name: 'shared', fields: [{ envVar: 'SHARED_KEY' }], createdBy: 'operator' })
    fillSecret(shared.id, { SHARED_KEY: 'v1' })
    const ref = createSecret({ companyId: 'c1', name: 'ref', fields: [{ envVar: 'SHARED_KEY' }], createdBy: 'agent' })
    const tied = tieSecret(ref.id, shared.id)
    expect(tied.status).toBe('filled')
    expect(tied.aliasOf).toBe(shared.id)
    expect(hasFilledSecret('c1', 'ref')).toBe(true)
    expect(injectEnv('c1').SHARED_KEY).toBe('v1')
  })

  it('reports filled vs pending via hasFilledSecret', () => {
    const s = createSecret({ companyId: 'c1', name: 'aws', fields: AWS, createdBy: 'operator' })
    expect(hasFilledSecret('c1', 'aws')).toBe(false)
    fillSecret(s.id, { AWS_ACCESS_KEY_ID: 'x', AWS_SECRET_ACCESS_KEY: 'y' })
    expect(hasFilledSecret('c1', 'aws')).toBe(true)
    expect(hasFilledSecret('c1', 'nope')).toBe(false)
  })

  it('deletes a secret and its values', () => {
    const s = createSecret({ companyId: 'c1', name: 'aws', fields: AWS, createdBy: 'operator' })
    fillSecret(s.id, { AWS_ACCESS_KEY_ID: 'x', AWS_SECRET_ACCESS_KEY: 'y' })
    deleteSecret(s.id)
    expect(listSecrets('c1')).toHaveLength(0)
    expect(injectEnv('c1')).toEqual({})
  })

  it('fillSecret requires every declared field', () => {
    const s = createSecret({ companyId: 'c1', name: 'aws', fields: AWS, createdBy: 'operator' })
    expect(() => fillSecret(s.id, { AWS_ACCESS_KEY_ID: 'only-one' })).toThrow(/missing value/i)
  })

  it('refuses to store plaintext when OS encryption is unavailable', () => {
    const s = createSecret({ companyId: 'c1', name: 'aws', fields: AWS, createdBy: 'operator' })
    state.available = false
    expect(() => fillSecret(s.id, { AWS_ACCESS_KEY_ID: 'x', AWS_SECRET_ACCESS_KEY: 'y' })).toThrow(/unavailable/i)
  })
})

describe('secrets.vault — agent inputs (M3d)', () => {
  it('upsertFilledInput stores a sensitive value encrypted and injects it decrypted', () => {
    upsertFilledInput('c1', 'AWS_ACCESS_KEY_ID', 'AKIA-XYZ', true)
    expect(injectEnv('c1')).toEqual({ AWS_ACCESS_KEY_ID: 'AKIA-XYZ' })
    expect(JSON.stringify(listSecrets('c1'))).not.toContain('AKIA-XYZ')   // never in metadata
  })

  it('upsertFilledInput stores a non-secret value in the clear and injects it as-is', () => {
    upsertFilledInput('c1', 'ORG_ID', 'o-123456', false)
    const s = listSecrets('c1').find(x => x.name === 'ORG_ID')!
    expect(s.sensitive).toBe(false)
    expect(injectEnv('c1').ORG_ID).toBe('o-123456')
  })

  it('upserting the same key twice updates in place (no duplicate slot)', () => {
    upsertFilledInput('c1', 'REGION', 'us-east-1', false)
    upsertFilledInput('c1', 'REGION', 'eu-west-1', false)
    expect(listSecrets('c1').filter(x => x.name === 'REGION')).toHaveLength(1)
    expect(injectEnv('c1').REGION).toBe('eu-west-1')
  })

  it('filledEnvVars lists env vars of filled secrets only', () => {
    const pending = createSecret({ companyId: 'c2', name: 'aws', fields: [{ envVar: 'AWS_ACCESS_KEY_ID' }], createdBy: 'operator' })
    expect(filledEnvVars('c2')).toEqual([])                 // pending → excluded
    fillSecret(pending.id, { AWS_ACCESS_KEY_ID: 'AKIA' })
    upsertFilledInput('c2', 'AWS_SECRET_ACCESS_KEY', 'shh', true)
    expect(new Set(filledEnvVars('c2'))).toEqual(new Set(['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']))
  })
})
