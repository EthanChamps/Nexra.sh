import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initSettingsDb, upsertFinding } from '../electron/services/store.sqlite'
import { saveGraph, readGraph, isEmptyGraph } from '../electron/services/store.graph'
import type { Company, Message } from '../electron/services/store.types'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nexra-graph-')); initSettingsDb(join(dir, 'nexra.db')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const msg = (over: Partial<Message> = {}): Message => ({ id: 'm1', role: 'user', kind: 'text', content: 'hi', ...over })

const company = (over: Partial<Company> = {}): Company => ({
  id: 'c1', name: 'Acme', updated: 'just now',
  engagements: [{
    id: 'e1', type: 'aws', name: 'AWS review', status: 'In Progress', updated: 'just now', linear: true,
    phases: [{ id: 'iam', label: 'IAM' }], scope: [{ label: 'Account', value: '1234' }],
    chats: [{
      id: 'ch1', name: 'Recon', phaseId: 'iam', color: '#123456',
      tools: [{ name: 'prowler', available: true }],
      messages: [msg({ id: 'm1', role: 'user' }), msg({ id: 'm2', role: 'assistant', kind: 'text', content: 'hello' })],
      findings: [],
    }],
  }],
  ...over,
})

describe('graph save/read', () => {
  it('is empty before any save', () => {
    expect(isEmptyGraph()).toBe(true)
    expect(readGraph()).toEqual([])
  })
  it('round-trips a full company graph', () => {
    saveGraph([company()])
    expect(isEmptyGraph()).toBe(false)
    const got = readGraph()
    expect(got).toEqual([company()])   // findings default [] (none persisted)
  })
  it('folds persisted findings into their chat', () => {
    saveGraph([company()])
    upsertFinding('ch1', { id: 'f1', title: 'Public bucket', sev: 'High', phase: 'IAM', time: 'now', rationale: 'x', verified: true, evidence: [{ kind: 'code_block', host: 'h', detail: 'd' }] })
    expect(readGraph()[0].engagements[0].chats[0].findings.map(f => f.id)).toEqual(['f1'])
  })
  it('upserts by id — re-saving updates, never duplicates', () => {
    saveGraph([company()])
    const edited = company()
    edited.name = 'Acme Corp'
    edited.engagements[0].chats[0].messages.push(msg({ id: 'm3', role: 'user', content: 'more' }))
    saveGraph([edited])
    const got = readGraph()
    expect(got).toHaveLength(1)
    expect(got[0].name).toBe('Acme Corp')
    expect(got[0].engagements[0].chats[0].messages.map(m => m.id)).toEqual(['m1', 'm2', 'm3'])
  })
  it('preserves order and request-card fields', () => {
    const c = company()
    c.engagements[0].chats[0].messages = [
      msg({ id: 'r1', role: 'assistant', kind: 'request', content: undefined, requestKind: 'inputs', requestId: 'req9', items: [{ key: 'AWS_ACCESS_KEY_ID', label: 'Key', sensitive: true, required: true }] }),
    ]
    saveGraph([c])
    const m = readGraph()[0].engagements[0].chats[0].messages[0]
    expect(m.kind).toBe('request')
    expect(m.requestKind).toBe('inputs')
    expect(m.items).toEqual([{ key: 'AWS_ACCESS_KEY_ID', label: 'Key', sensitive: true, required: true }])
  })
})
