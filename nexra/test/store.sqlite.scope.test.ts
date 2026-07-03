import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initSettingsDb, insertScopeItem, deleteScopeItem, listScopeItems } from '../electron/services/store.sqlite'
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
