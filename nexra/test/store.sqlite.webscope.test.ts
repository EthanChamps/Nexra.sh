import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initSettingsDb, setScopeRow, getScopeRow, closeDb } from '../electron/services/store.sqlite'
import type { EngagementScope } from '../electron/services/store.types'

describe('web scope persistence', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-webscope-')); initSettingsDb(join(dir, 'nexra.db')) })
  // Close the sqlite handle before rmSync — on Windows an open handle blocks
  // deleting the temp dir (EPERM).
  afterEach(() => { closeDb(); rmSync(dir, { recursive: true, force: true }) })

  it('round-trips web scope fields', () => {
    const s: EngagementScope = {
      mode: 'allowlist', accounts: [], regions: [],
      hosts: ['app.acme.com'], wildcards: ['*.acme.com'],
      urlPrefixes: ['https://app.acme.com/api/'], exclusions: ['admin.acme.com'],
    }
    setScopeRow('web1', s)
    expect(getScopeRow('web1')).toMatchObject({
      hosts: ['app.acme.com'], wildcards: ['*.acme.com'],
      urlPrefixes: ['https://app.acme.com/api/'], exclusions: ['admin.acme.com'],
    })
  })

  it('defaults web fields to [] for a legacy (cloud) row', () => {
    setScopeRow('aws1', { mode: 'allowlist', accounts: ['1'], regions: [] })
    expect(getScopeRow('aws1')).toMatchObject({ hosts: [], wildcards: [], urlPrefixes: [], exclusions: [] })
  })
})
