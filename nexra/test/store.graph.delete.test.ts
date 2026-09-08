import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, initSettingsDb, upsertFinding, listFindingsByChat } from '../electron/services/store.sqlite'
import { saveGraph, readGraph, deleteChatGraph, deleteCompanyGraph } from '../electron/services/store.graph'
import type { Company } from '../electron/services/store.types'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-del-')); initSettingsDb(join(dir, 'nexra.db')) })
afterEach(() => { closeDb(); rmSync(dir, { recursive: true, force: true }) })

const two = (): Company[] => ([
  { id: 'c1', name: 'Acme', updated: 'now', engagements: [
    { id: 'e1', type: 'aws', name: 'AWS', status: 'In Progress', updated: 'now', linear: true, phases: [], scope: [], chats: [
      { id: 'ch1', name: 'A', phaseId: 'p', color: '#111', messages: [{ id: 'm1', role: 'user', kind: 'text', content: 'x' }], findings: [] },
      { id: 'ch2', name: 'B', phaseId: 'p', color: '#222', messages: [], findings: [] },
    ] },
  ] },
  { id: 'c2', name: 'Beta', updated: 'now', engagements: [] },
])

describe('cascade deletes', () => {
  it('deleteChatGraph removes the chat, its messages and findings; siblings stay', () => {
    saveGraph(two())
    upsertFinding('ch1', { id: 'f1', title: 't', sev: 'Low', phase: 'p', time: 'now', rationale: 'r', verified: false, evidence: [] })
    deleteChatGraph('ch1')
    const chats = readGraph()[0].engagements[0].chats
    expect(chats.map(c => c.id)).toEqual(['ch2'])
    expect(listFindingsByChat('ch1')).toEqual([])
  })
  it('deleteCompanyGraph removes everything under the company; other company stays', () => {
    saveGraph(two())
    upsertFinding('ch1', { id: 'f1', title: 't', sev: 'Low', phase: 'p', time: 'now', rationale: 'r', verified: false, evidence: [] })
    deleteCompanyGraph('c1')
    expect(readGraph().map(c => c.id)).toEqual(['c2'])
    expect(listFindingsByChat('ch1')).toEqual([])
  })
})
