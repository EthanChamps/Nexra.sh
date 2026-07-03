import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initSettingsDb } from '../electron/services/store.sqlite'
import { readSnapshot, isEmptyGraph, saveGraph } from '../electron/services/store.graph'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-snap-')); initSettingsDb(join(dir, 'nexra.db')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('readSnapshot', () => {
  it('seeds an empty db once and returns companies + types', () => {
    expect(isEmptyGraph()).toBe(true)
    const snap = readSnapshot()
    expect(snap.companies.length).toBeGreaterThan(0)
    expect(Object.keys(snap.types)).toContain('aws')
    expect(isEmptyGraph()).toBe(false)
  })
  it('does not re-seed a non-empty db', () => {
    saveGraph([{ id: 'only', name: 'Only Co', updated: 'now', engagements: [] }])
    const snap = readSnapshot()
    expect(snap.companies.map(c => c.id)).toEqual(['only'])
  })
})
