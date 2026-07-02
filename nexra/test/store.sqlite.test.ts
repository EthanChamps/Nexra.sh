import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initSettingsDb, getSetting, setSetting } from '../electron/services/store.sqlite'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-')) ; initSettingsDb(join(dir, 'nexra.db')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

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
