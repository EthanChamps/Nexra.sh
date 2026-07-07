import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initSettingsDb, insertScopeItem, deleteScopeItem, listScopeItems, getDb } from '../electron/services/store.sqlite'
import type { ScopeItem } from '../electron/services/store.types'

const item = (over: Partial<ScopeItem> = {}): ScopeItem =>
  ({ id: 'si1', type: 'cloud_account', value: '111111111111', source: 'user', addedAt: 10, ...over })

describe('project_scope persistence', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-pscope-')); initSettingsDb(join(dir, 'nexra.db')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('is empty until an item is inserted', () => {
    expect(listScopeItems('c1')).toEqual([])
  })

  it('round-trips items per company, ordered by addedAt', () => {
    insertScopeItem('c1', item({ id: 'a', value: '111111111111', addedAt: 20 }))
    insertScopeItem('c1', item({ id: 'b', type: 'cidr', value: '10.0.0.0/8', addedAt: 10 }))
    insertScopeItem('c2', item({ id: 'c', value: '999999999999', addedAt: 5 }))
    expect(listScopeItems('c1').map(i => i.id)).toEqual(['b', 'a'])
    expect(listScopeItems('c2').map(i => i.id)).toEqual(['c'])
  })

  it('deletes only the matching (company, id) pair', () => {
    insertScopeItem('c1', item({ id: 'a' }))
    insertScopeItem('c1', item({ id: 'b', type: 'region', value: 'us-east-1' }))
    deleteScopeItem('c1', 'a')
    expect(listScopeItems('c1').map(i => i.id)).toEqual(['b'])
  })
})

describe('schema migration: legacy scope table drop', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-pscope-migrate-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('drops a legacy per-engagement scope table on reopen, while project_scope keeps working', () => {
    const dbPath = join(dir, 'nexra.db')
    initSettingsDb(dbPath)

    // Simulate a pre-M3d DB that still has the legacy per-engagement table.
    getDb().exec(
      "CREATE TABLE IF NOT EXISTS scope (engagement_id TEXT PRIMARY KEY, mode TEXT, accounts TEXT, regions TEXT)"
    )
    getDb()
      .prepare('INSERT INTO scope (engagement_id, mode, accounts, regions) VALUES (?, ?, ?, ?)')
      .run('e1', 'enforced', '["111111111111"]', '["us-east-1"]')

    // Reopening the same path simulates the app restarting against a legacy DB.
    initSettingsDb(dbPath)

    const legacyTable = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scope'")
      .get()
    expect(legacyTable).toBeUndefined()

    insertScopeItem('c1', item({ id: 'post-migration', value: '222222222222', addedAt: 30 }))
    expect(listScopeItems('c1').map(i => i.id)).toEqual(['post-migration'])
  })
})
