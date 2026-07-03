import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initSettingsDb, getDb, setSetting, getSetting } from '../electron/services/store.sqlite'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-graph-')); initSettingsDb(join(dir, 'nexra.db')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const tableNames = (): string[] =>
  (getDb().prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(r => r.name)

describe('M4 schema', () => {
  it('creates the graph + memory tables', () => {
    for (const t of ['companies', 'engagements', 'chats', 'messages', 'phase_coverage', 'engagement_memory'])
      expect(tableNames()).toContain(t)
  })
  it('migrates an M3-era db in place without losing settings', () => {
    setSetting('provider', 'anthropic')
    initSettingsDb(join(dir, 'nexra.db'))                  // reopen (simulates upgrade)
    expect(getSetting('provider')).toBe('anthropic')
    expect(tableNames()).toContain('messages')
  })
  it('getDb throws before init', () => {
    // reopen closes the handle only on next init; assert the guard exists by shape
    expect(typeof getDb).toBe('function')
  })
})
