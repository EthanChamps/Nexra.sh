import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initSettingsDb } from '../electron/services/store.sqlite'
import { getProjectScope, addScopeItem, removeScopeItem, setScopeNotes, matchesScope, ipInCidr } from '../electron/services/scope'
import type { ProjectScope, ScopeItem } from '../electron/services/store.types'

const scopeOf = (items: Partial<ScopeItem>[], notes = ''): ProjectScope => ({
  companyId: 'c1', notes,
  items: items.map((i, n) => ({ id: 'i' + n, type: 'cloud_account', value: '', source: 'user', addedAt: n, ...i } as ScopeItem)),
})

describe('ipInCidr (IPv4)', () => {
  it('matches an address inside the range', () => {
    expect(ipInCidr('10.1.2.3', '10.0.0.0/8')).toBe(true)
    expect(ipInCidr('192.168.1.5', '192.168.1.0/24')).toBe(true)
    expect(ipInCidr('1.2.3.4', '0.0.0.0/0')).toBe(true)
  })
  it('rejects an address outside the range and malformed input', () => {
    expect(ipInCidr('10.1.2.3', '11.0.0.0/8')).toBe(false)
    expect(ipInCidr('192.168.2.5', '192.168.1.0/24')).toBe(false)
    expect(ipInCidr('not-an-ip', '10.0.0.0/8')).toBe(false)
    expect(ipInCidr('10.0.0.1', '10.0.0.0/33')).toBe(false)
  })
})

describe('matchesScope (pure, below the LLM)', () => {
  it('empty scope denies and proposes the target account', () => {
    const d = matchesScope({ account: '111111111111' }, scopeOf([]))
    expect(d.allowed).toBe(false)
    expect(d.propose).toEqual({ type: 'cloud_account', value: '111111111111' })
  })
  it('permits an in-scope cloud account', () => {
    expect(matchesScope({ account: '111111111111' }, scopeOf([{ type: 'cloud_account', value: '111111111111' }])).allowed).toBe(true)
  })
  it('denies an out-of-scope account and proposes it', () => {
    const d = matchesScope({ account: '999999999999' }, scopeOf([{ type: 'cloud_account', value: '111111111111' }]))
    expect(d.allowed).toBe(false)
    expect(d.reason).toMatch(/out of scope/i)
    expect(d.propose).toEqual({ type: 'cloud_account', value: '999999999999' })
  })
  it('leaves region unconstrained when scope has no region items', () => {
    expect(matchesScope({ account: '111111111111', region: 'eu-west-9' }, scopeOf([{ type: 'cloud_account', value: '111111111111' }])).allowed).toBe(true)
  })
  it('enforces region once a region item exists', () => {
    const scope = scopeOf([{ type: 'cloud_account', value: '111111111111' }, { type: 'region', value: 'us-east-1' }])
    expect(matchesScope({ account: '111111111111', region: 'us-east-1' }, scope).allowed).toBe(true)
    const d = matchesScope({ account: '111111111111', region: 'eu-west-1' }, scope)
    expect(d.allowed).toBe(false)
    expect(d.propose).toEqual({ type: 'region', value: 'eu-west-1' })
  })
  it('matches an ip inside a cidr item and a hostname behind a url item', () => {
    expect(matchesScope({ ip: '10.9.9.9' }, scopeOf([{ type: 'cidr', value: '10.0.0.0/8' }])).allowed).toBe(true)
    expect(matchesScope({ hostname: 'app.acme.com' }, scopeOf([{ type: 'url', value: 'https://app.acme.com/login' }])).allowed).toBe(true)
    expect(matchesScope({ url: 'https://app.acme.com/x' }, scopeOf([{ type: 'hostname', value: 'app.acme.com' }])).allowed).toBe(true)
  })
  it('never matches on `other` items and denies when nothing is checkable', () => {
    expect(matchesScope({ account: '111111111111' }, scopeOf([{ type: 'other', value: 'note' }])).allowed).toBe(false)
    expect(matchesScope({}, scopeOf([{ type: 'cloud_account', value: '111111111111' }])).allowed).toBe(false)
  })
})

describe('project scope persistence', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-pscopesvc-')); initSettingsDb(join(dir, 'nexra.db')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('add/list/remove round-trips with generated id + source', () => {
    const added = addScopeItem('c1', { type: 'cloud_account', value: ' 111111111111 ', source: 'user' })
    expect(added.id).toBeTruthy()
    expect(added.value).toBe('111111111111')     // trimmed
    const scope = getProjectScope('c1')
    expect(scope.items).toHaveLength(1)
    removeScopeItem('c1', added.id)
    expect(getProjectScope('c1').items).toEqual([])
  })

  it('notes persist per company', () => {
    expect(getProjectScope('c1').notes).toBe('')
    setScopeNotes('c1', 'No DoS. Business hours only.')
    expect(getProjectScope('c1').notes).toBe('No DoS. Business hours only.')
    expect(getProjectScope('c2').notes).toBe('')
  })
})
