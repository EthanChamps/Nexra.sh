import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initSettingsDb } from '../electron/services/store.sqlite'
import { getProjectScope, addScopeItem, removeScopeItem, setScopeNotes } from '../electron/services/scope'

describe('projectScope IPC contract (service pass-through)', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-pscope-ipc-')); initSettingsDb(join(dir, 'nexra.db')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('add → get → set-notes → remove behaves as the handlers expect', () => {
    const added = addScopeItem('c1', { type: 'hostname', value: 'app.acme.com', source: 'agent' })
    setScopeNotes('c1', 'rules')
    let scope = getProjectScope('c1')
    expect(scope.items.map(i => i.value)).toEqual(['app.acme.com'])
    expect(scope.items[0].source).toBe('agent')
    expect(scope.notes).toBe('rules')
    removeScopeItem('c1', added.id)
    scope = getProjectScope('c1')
    expect(scope.items).toEqual([])
    expect(scope.notes).toBe('rules')
  })
})
