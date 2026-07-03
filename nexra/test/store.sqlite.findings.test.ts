import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initSettingsDb, setSetting, getSetting, upsertFinding, listFindingsByChat } from '../electron/services/store.sqlite'
import type { Finding } from '../electron/services/store.types'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-fnd-')); initSettingsDb(join(dir, 'nexra.db')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const f = (over: Partial<Finding> = {}): Finding => ({
  id: 'f1', title: 'Public S3 bucket', sev: 'High', phase: 'Storage', time: 'just now',
  rationale: 'World-readable ACL', verified: true,
  evidence: [{ kind: 'tool_output', toolCallId: 'tc7', excerpt: 'BucketPublicAccess: true' }],
  ...over,
})

describe('findings store', () => {
  it('returns [] for a chat with no findings', () => {
    expect(listFindingsByChat('chatX')).toEqual([])
  })
  it('round-trips a finding with its evidence', () => {
    upsertFinding('chatA', f())
    const got = listFindingsByChat('chatA')
    expect(got).toHaveLength(1)
    expect(got[0]).toEqual(f())
  })
  it('upsert replaces the row and its evidence in place (no dup, no stale evidence)', () => {
    upsertFinding('chatA', f({ verified: false, evidence: [] }))
    upsertFinding('chatA', f({ verified: true, evidence: [{ kind: 'code_block', host: 's3://acme', detail: 'ACL public-read' }] }))
    const got = listFindingsByChat('chatA')
    expect(got).toHaveLength(1)
    expect(got[0].verified).toBe(true)
    expect(got[0].evidence).toEqual([{ kind: 'code_block', host: 's3://acme', detail: 'ACL public-read' }])
  })
  it('scopes findings by chat', () => {
    upsertFinding('chatA', f({ id: 'a1' }))
    upsertFinding('chatB', f({ id: 'b1' }))
    expect(listFindingsByChat('chatA').map(x => x.id)).toEqual(['a1'])
  })
  it('survives a reopen and does not disturb settings/secrets/scope tables', () => {
    setSetting('provider', 'anthropic')
    upsertFinding('chatA', f())
    initSettingsDb(join(dir, 'nexra.db'))               // reopen existing db
    expect(getSetting('provider')).toBe('anthropic')     // migration additive
    expect(listFindingsByChat('chatA')).toEqual([f()])   // evidence excerpt intact
  })
})
