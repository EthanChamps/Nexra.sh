import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initSettingsDb } from '../electron/services/store.sqlite'
import { getScope, setScope, validate } from '../electron/services/scope'
import type { EngagementScope } from '../electron/services/store.types'

describe('scope.validate (pure, below the LLM)', () => {
  const all: EngagementScope = { mode: 'all', accounts: [], regions: [] }
  it('mode:all permits anything', () => {
    expect(validate({ account: '123', region: 'us-east-1' }, all).allowed).toBe(true)
    expect(validate({}, all).allowed).toBe(true)
  })

  it('allowlist permits an in-scope account/region', () => {
    const s: EngagementScope = { mode: 'allowlist', accounts: ['111111111111'], regions: ['us-east-1'] }
    expect(validate({ account: '111111111111', region: 'us-east-1' }, s).allowed).toBe(true)
  })

  it('allowlist denies an out-of-scope account', () => {
    const s: EngagementScope = { mode: 'allowlist', accounts: ['111111111111'], regions: [] }
    const d = validate({ account: '999999999999' }, s)
    expect(d.allowed).toBe(false)
    expect(d.reason).toMatch(/out of scope/i)
  })

  it('allowlist denies an out-of-scope region', () => {
    const s: EngagementScope = { mode: 'allowlist', accounts: [], regions: ['us-east-1'] }
    expect(validate({ region: 'eu-west-1' }, s).allowed).toBe(false)
  })

  it('allowlist requires the dimension it restricts', () => {
    const s: EngagementScope = { mode: 'allowlist', accounts: ['111111111111'], regions: [] }
    expect(validate({}, s).allowed).toBe(false)   // no account given
  })

  it('an empty allowlist fails closed (nothing in scope)', () => {
    const s: EngagementScope = { mode: 'allowlist', accounts: [], regions: [] }
    expect(validate({ account: '111111111111' }, s).allowed).toBe(false)
  })

  it('allowlist permits an in-scope tenant', () => {
    const s: EngagementScope = { mode: 'allowlist', accounts: [], regions: [], tenants: ['contoso.onmicrosoft.com'] }
    expect(validate({ tenant: 'contoso.onmicrosoft.com' }, s).allowed).toBe(true)
  })

  it('allowlist denies an out-of-scope tenant', () => {
    const s: EngagementScope = { mode: 'allowlist', accounts: [], regions: [], tenants: ['contoso.onmicrosoft.com'] }
    const d = validate({ tenant: 'evil.onmicrosoft.com' }, s)
    expect(d.allowed).toBe(false)
    expect(d.reason).toMatch(/out of scope/i)
  })

  it('allowlist requires the tenant it restricts', () => {
    const s: EngagementScope = { mode: 'allowlist', accounts: [], regions: [], tenants: ['contoso.onmicrosoft.com'] }
    expect(validate({}, s).allowed).toBe(false)
  })

  it('an allowlist with only tenants still fails closed when target has none', () => {
    const s: EngagementScope = { mode: 'allowlist', accounts: [], regions: [], tenants: [] }
    expect(validate({ tenant: 'contoso.onmicrosoft.com' }, s).allowed).toBe(false)
  })
})

describe('scope persistence', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-scope-')); initSettingsDb(join(dir, 'nexra.db')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('is undefined until set (the gate)', () => {
    expect(getScope('eng1')).toBeUndefined()
  })

  it('round-trips a scope record', () => {
    const s: EngagementScope = { mode: 'allowlist', accounts: ['111111111111'], regions: ['us-east-1', 'us-west-2'] }
    setScope('eng1', s)
    expect(getScope('eng1')).toEqual({ ...s, tenants: [] })
  })

  it('overwrites on repeat set', () => {
    setScope('eng1', { mode: 'allowlist', accounts: ['1'], regions: [] })
    setScope('eng1', { mode: 'all', accounts: [], regions: [] })
    expect(getScope('eng1')?.mode).toBe('all')
  })

  it('round-trips tenants and defaults a legacy row without them to []', () => {
    setScope('m365eng', { mode: 'allowlist', accounts: [], regions: [], tenants: ['contoso.onmicrosoft.com'] })
    expect(getScope('m365eng')).toEqual({ mode: 'allowlist', accounts: [], regions: [], tenants: ['contoso.onmicrosoft.com'] })
  })
})
