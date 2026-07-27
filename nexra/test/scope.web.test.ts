import { describe, it, expect } from 'vitest'
import { normalizeUrl, hostMatches, isExcluded, validateWebTarget } from '../electron/services/scope.web'
import type { EngagementScope } from '../electron/services/store.types'

const base: EngagementScope = { mode: 'allowlist', accounts: [], regions: [],
  hosts: ['app.acme.com'], wildcards: ['*.acme.com'], urlPrefixes: [], exclusions: [] }

describe('normalizeUrl', () => {
  it('lowercases host and strips default port', () => {
    expect(normalizeUrl('https://APP.ACME.COM:443/x')).toEqual({ host: 'app.acme.com', url: 'https://app.acme.com/x' })
  })
  it('resolves dot segments', () => {
    expect(normalizeUrl('https://app.acme.com/a/../b')?.url).toBe('https://app.acme.com/b')
  })
  it('rejects non-http(s) and garbage', () => {
    expect(normalizeUrl('file:///etc/passwd')).toBeNull()
    expect(normalizeUrl('not a url')).toBeNull()
  })
})

describe('hostMatches', () => {
  it('exact host', () => { expect(hostMatches('app.acme.com', ['app.acme.com'], [])).toBe(true) })
  it('wildcard at a label boundary', () => {
    expect(hostMatches('api.acme.com', [], ['*.acme.com'])).toBe(true)
    expect(hostMatches('notacme.com', [], ['*.acme.com'])).toBe(false)
    expect(hostMatches('acme.com', [], ['*.acme.com'])).toBe(false)
  })
})

describe('isExcluded', () => {
  it('matches an excluded host and its subdomains', () => {
    expect(isExcluded('admin.acme.com', 'https://admin.acme.com/', ['admin.acme.com'])).toBe(true)
    expect(isExcluded('x.admin.acme.com', 'https://x.admin.acme.com/', ['admin.acme.com'])).toBe(true)
    expect(isExcluded('app.acme.com', 'https://app.acme.com/', ['admin.acme.com'])).toBe(false)
  })
  it('matches an excluded URL prefix', () => {
    expect(isExcluded('app.acme.com', 'https://app.acme.com/internal/x', ['https://app.acme.com/internal'])).toBe(true)
  })
})

describe('validateWebTarget', () => {
  it('allows an in-scope host', () => { expect(validateWebTarget('https://app.acme.com/x', base).allowed).toBe(true) })
  it('denies an out-of-scope host', () => {
    const d = validateWebTarget('https://evil.com/', base)
    expect(d.allowed).toBe(false); expect(d.reason).toMatch(/out of scope/i)
  })
  it('exclusions win over the allowlist', () => {
    const s = { ...base, exclusions: ['admin.acme.com'] }
    expect(validateWebTarget('https://admin.acme.com/', s).allowed).toBe(false)
  })
  it('enforces urlPrefixes when set', () => {
    const s = { ...base, urlPrefixes: ['https://app.acme.com/api/'] }
    expect(validateWebTarget('https://app.acme.com/api/users', s).allowed).toBe(true)
    expect(validateWebTarget('https://app.acme.com/admin', s).allowed).toBe(false)
  })
  it('denies a missing/unparseable target and fails closed on empty allowlist', () => {
    expect(validateWebTarget(undefined, base).allowed).toBe(false)
    expect(validateWebTarget('nonsense', base).allowed).toBe(false)
    expect(validateWebTarget('https://app.acme.com/', { ...base, hosts: [], wildcards: [], urlPrefixes: [] }).allowed).toBe(false)
  })
})
