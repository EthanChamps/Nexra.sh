import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initSettingsDb } from '../electron/services/store.sqlite'
import { saveGraph, readGraph } from '../electron/services/store.graph'
import type { Company } from '../electron/services/store.types'

const companies: Company[] = [{
  id: 'c1', name: 'Acme', updated: 'now',
  engagements: [{
    id: 'e1', type: 'external', name: 'Ext', status: 'In Progress', updated: 'now', linear: true,
    phases: [{ id: 'recon', label: 'Recon' }], scope: [],
    chats: [{
      id: 'ch1', name: 'Recon', phaseId: 'recon', color: '#000', findings: [],
      messages: [{ id: 'm1', role: 'assistant', kind: 'request', requestKind: 'scope_proposal', proposeItem: { type: 'hostname', value: 'admin.acme.com' }, reason: 'dns' }],
    }],
  }],
}]

describe('scope_proposal message persistence', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-graph-scope-')); initSettingsDb(join(dir, 'nexra.db')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('round-trips proposeItem through save/read', () => {
    saveGraph(companies)
    const msg = readGraph()[0].engagements[0].chats[0].messages[0]
    expect(msg.requestKind).toBe('scope_proposal')
    expect(msg.proposeItem).toEqual({ type: 'hostname', value: 'admin.acme.com' })
  })
})
