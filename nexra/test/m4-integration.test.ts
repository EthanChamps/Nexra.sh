import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, initSettingsDb, upsertFinding } from '../electron/services/store.sqlite'
import { readSnapshot, saveGraph } from '../electron/services/store.graph'
import type { Company } from '../electron/services/store.types'

let dir: string, dbPath: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-m4-')); dbPath = join(dir, 'nexra.db'); initSettingsDb(dbPath) })
afterEach(() => { closeDb(); rmSync(dir, { recursive: true, force: true }) })

describe('M4 done-when: a full engagement survives restart', () => {
  it('persists company→engagement→chat→messages→findings across a reopen', () => {
    // 1. a fresh workspace is empty; demo data is never injected into real storage
    const first = readSnapshot()
    expect(first.companies).toEqual([])

    // 2. operator builds a new engagement graph and it autosaves
    const graph: Company[] = [{
      id: 'c9', name: 'Client Nine', updated: 'now', engagements: [{
        id: 'e9', type: 'aws', name: 'AWS config review', status: 'In Progress', updated: 'now', linear: true,
        phases: [{ id: 'iam', label: 'IAM' }], scope: [], chats: [{
          id: 'ch9', name: 'IAM recon', phaseId: 'iam', color: '#3355ff',
          messages: [
            { id: 'm1', role: 'user', kind: 'text', content: 'audit IAM' },
            { id: 'm2', role: 'assistant', kind: 'text', content: 'Running Prowler…' },
            { id: 'm3', role: 'assistant', kind: 'tool', toolName: 'run_prowler', output: 'ok', state: 'success' },
          ],
          findings: [],
        }],
      }],
    }, ...first.companies]
    saveGraph(graph)
    upsertFinding('ch9', { id: 'f9', title: 'Wildcard IAM policy', sev: 'Critical', phase: 'IAM', time: 'now', rationale: 'admin *', verified: true, evidence: [{ kind: 'tool_output', toolCallId: 'run_prowler', excerpt: 'Action: *' }] })

    // 3. RESTART: reopen the same db file
    initSettingsDb(dbPath)

    // 4. everything is present and correct
    const snap = readSnapshot()   // must NOT re-seed (db non-empty)
    const c9 = snap.companies.find(c => c.id === 'c9')!
    expect(c9.name).toBe('Client Nine')
    const chat = c9.engagements[0].chats[0]
    expect(chat.messages.map(m => m.id)).toEqual(['m1', 'm2', 'm3'])
    expect(chat.messages[2].state).toBe('success')
    expect(chat.findings.map(f => f.id)).toEqual(['f9'])
    expect(chat.findings[0].evidence[0]).toEqual({ kind: 'tool_output', toolCallId: 'run_prowler', excerpt: 'Action: *' })
  })
})
