import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, initSettingsDb } from '../electron/services/store.sqlite'
import { readSnapshot, isEmptyGraph, saveGraph } from '../electron/services/store.graph'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-snap-')); initSettingsDb(join(dir, 'nexra.db')) })
afterEach(() => { closeDb(); rmSync(dir, { recursive: true, force: true }) })

describe('readSnapshot', () => {
  it('starts empty — no demo seeding — but still returns the review types', () => {
    expect(isEmptyGraph()).toBe(true)
    const snap = readSnapshot()
    expect(snap.companies).toEqual([])
    expect(Object.keys(snap.types)).toContain('aws')
    expect(isEmptyGraph()).toBe(true)   // reading never writes seed data
  })
  it('returns exactly the persisted graph, nothing injected', () => {
    saveGraph([{ id: 'only', name: 'Only Co', updated: 'now', engagements: [] }])
    const snap = readSnapshot()
    expect(snap.companies.map(c => c.id)).toEqual(['only'])
  })
})
