import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, initSettingsDb, getSetting, setSetting, insertSecretMeta, getSecretMeta } from '../electron/services/store.sqlite'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-')) ; initSettingsDb(join(dir, 'nexra.db')) })
afterEach(() => { closeDb(); rmSync(dir, { recursive: true, force: true }) })

describe('settings store', () => {
  it('returns undefined for a missing key', () => {
    expect(getSetting('provider')).toBeUndefined()
  })
  it('round-trips a value', () => {
    setSetting('provider', 'anthropic')
    expect(getSetting('provider')).toBe('anthropic')
  })
  it('overwrites on repeat set', () => {
    setSetting('model', 'claude-opus-4-8')
    setSetting('model', 'claude-sonnet-5')
    expect(getSetting('model')).toBe('claude-sonnet-5')
  })
  it('re-initializing an existing db keeps data', () => {
    setSetting('provider', 'ollama')
    initSettingsDb(join(dir, 'nexra.db'))
    expect(getSetting('provider')).toBe('ollama')
  })
})

describe('secret metadata — sensitive flag (M3d)', () => {
  it('round-trips the sensitive flag (true/false/undefined)', () => {
    insertSecretMeta({ id: 's-sens', companyId: 'c1', name: 'AWS_SECRET_ACCESS_KEY', fields: [{ envVar: 'AWS_SECRET_ACCESS_KEY' }], status: 'filled', createdBy: 'agent', sensitive: true })
    insertSecretMeta({ id: 's-plain', companyId: 'c1', name: 'ORG_ID', fields: [{ envVar: 'ORG_ID' }], status: 'filled', createdBy: 'agent', sensitive: false })
    insertSecretMeta({ id: 's-legacy', companyId: 'c1', name: 'aws-prod', fields: [{ envVar: 'AWS_ACCESS_KEY_ID' }], status: 'pending', createdBy: 'operator' })
    expect(getSecretMeta('s-sens')!.sensitive).toBe(true)
    expect(getSecretMeta('s-plain')!.sensitive).toBe(false)
    expect(getSecretMeta('s-legacy')!.sensitive).toBeUndefined()
  })
})
