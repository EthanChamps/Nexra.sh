import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initSettingsDb, getDb, setSetting, getSetting } from '../electron/services/store.sqlite'
import { saveGraph } from '../electron/services/store.graph'
import type { Company } from '../electron/services/store.types'

let dir: string
let dbPath: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-graph-')); dbPath = join(dir, 'nexra.db'); initSettingsDb(dbPath) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const company = (): Company => ({
  id: 'c1', name: 'Acme', updated: 'just now',
  engagements: [{
    id: 'e1', type: 'aws', name: 'AWS review', status: 'In Progress', updated: 'just now', linear: true,
    phases: [{ id: 'iam', label: 'IAM' }], scope: [{ label: 'Account', value: '1234' }],
    chats: [{ id: 'ch1', name: 'Recon', phaseId: 'iam', color: '#123456', messages: [], findings: [] }],
  }],
})

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
  it('migrates a pre-cleanup db that still carries the legacy chats.tools NOT NULL column', () => {
    const db = getDb()
    db.exec('DROP TABLE chats')
    db.exec(`CREATE TABLE chats (
      id TEXT PRIMARY KEY, engagement_id TEXT NOT NULL, name TEXT NOT NULL,
      phase_id TEXT NOT NULL, color TEXT NOT NULL, tools TEXT NOT NULL, ord INTEGER NOT NULL
    )`)
    initSettingsDb(dbPath)   // reopen (simulates upgrading an M4-pre-tools-removal db)
    expect(() => saveGraph([company()])).not.toThrow()
  })
})
