import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initSettingsDb } from '../electron/services/store.sqlite'
import { setPhaseCoverage, listPhaseCoverage, appendMemory, listMemory } from '../electron/services/store.memory'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-mem-')); initSettingsDb(join(dir, 'nexra.db')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('phase coverage', () => {
  it('upserts status per (engagement, phase)', () => {
    setPhaseCoverage('e1', 'iam', 'in_progress')
    setPhaseCoverage('e1', 'iam', 'done')
    setPhaseCoverage('e1', 'storage', 'pending')
    expect(listPhaseCoverage('e1')).toEqual([
      { phaseId: 'iam', status: 'done' },
      { phaseId: 'storage', status: 'pending' },
    ])
  })
  it('scopes by engagement', () => {
    setPhaseCoverage('e1', 'iam', 'done')
    setPhaseCoverage('e2', 'iam', 'pending')
    expect(listPhaseCoverage('e2')).toEqual([{ phaseId: 'iam', status: 'pending' }])
  })
})

describe('engagement memory', () => {
  it('appends and lists in insertion order', () => {
    appendMemory('e1', 'target', 'acct 1234 / us-east-1', 'ch1')
    appendMemory('e1', 'dead_end', 'no ScoutSuite access')
    const got = listMemory('e1')
    expect(got.map(m => m.kind)).toEqual(['target', 'dead_end'])
    expect(got[0]).toMatchObject({ kind: 'target', content: 'acct 1234 / us-east-1', chatId: 'ch1' })
    expect(got[1].chatId).toBeUndefined()
  })
})
