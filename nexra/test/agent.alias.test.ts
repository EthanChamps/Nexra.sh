import { describe, it, expect } from 'vitest'
import { createAliaser } from '../electron/services/agent.alias'

describe('createAliaser — de-identifying model-bound text', () => {
  it('masks a host in a URL but keeps scheme/path/query (client identity, not signal, is removed)', () => {
    const a = createAliaser()
    const masked = a.mask('probe https://app.acme.com/admin?id=1 now')
    expect(masked).not.toContain('acme.com')
    expect(masked).toMatch(/https:\/\/h\d+\.masked\.local\/admin\?id=1/)
  })

  it('assigns a stable handle to the same host across calls', () => {
    const a = createAliaser()
    const first = a.mask('https://app.acme.com/a')
    const second = a.mask('again https://app.acme.com/b')
    const h1 = first.match(/h\d+\.masked\.local/)![0]
    expect(second).toContain(h1)
  })

  it('gives different hosts different handles', () => {
    const a = createAliaser()
    const out = a.mask('https://app.acme.com and https://api.other.io')
    const handles = [...out.matchAll(/h\d+\.masked\.local/g)].map(m => m[0])
    expect(new Set(handles).size).toBe(2)
  })

  it('masks a bare (schemeless) host once it is known from a URL or registration', () => {
    const a = createAliaser()
    a.registerHost('app.acme.com')
    const out = a.mask('headers/tls: 1 issue on app.acme.com')
    expect(out).not.toContain('acme.com')
    expect(out).toMatch(/h\d+\.masked\.local/)
  })

  it('leaves text with no hosts untouched', () => {
    const a = createAliaser()
    expect(a.mask('nuclei: no findings.')).toBe('nuclei: no findings.')
  })

  it('reveal/resolveUrl turns a handle back into the real URL for spawning', () => {
    const a = createAliaser()
    a.registerHost('app.acme.com')                     // -> h1.masked.local
    const masked = a.mask('https://app.acme.com/x')     // https://h1.masked.local/x
    expect(a.resolveUrl(masked)).toBe('https://app.acme.com/x')
  })

  it('resolveUrl passes through a URL that carries no handle (backward compatible)', () => {
    const a = createAliaser()
    expect(a.resolveUrl('https://app.acme.com/x')).toBe('https://app.acme.com/x')
  })

  it('unmask restores handles in model-authored text for operator display', () => {
    const a = createAliaser()
    a.registerHost('app.acme.com')
    const masked = a.mask('found sqli on https://app.acme.com/login')
    expect(a.unmask(masked)).toContain('app.acme.com')
  })

  it('round-trips a discovered host (seen only in a summary) through mask then resolve', () => {
    const a = createAliaser()
    // katana-style summary lists an endpoint the aliaser has never registered
    const masked = a.mask('katana: 1 endpoint (e.g. https://api.acme.com/v2/users)')
    expect(masked).not.toContain('acme.com')
    const handleUrl = masked.match(/https:\/\/h\d+\.masked\.local[^\s)]*/)![0]
    expect(a.resolveUrl(handleUrl)).toBe('https://api.acme.com/v2/users')
  })
})
