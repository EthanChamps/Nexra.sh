import { describe, it, expect } from 'vitest'
import { createRunRegistry, evidenceFromArgs, computeVerified, normalizeSev, EXCERPT_MAX } from '../electron/services/agent.findings'
import type { AgentEvent } from '../electron/services/agent.types'

describe('createRunRegistry', () => {
  it('accumulates skill stdout chunks by invocation id', () => {
    const r = createRunRegistry()
    const evs: AgentEvent[] = [
      { type: 'skill', id: 'tc1', skill: 'run_prowler', state: 'running' },
      { type: 'skill', id: 'tc1', skill: 'run_prowler', state: 'output', chunk: 'Bucket ' },
      { type: 'skill', id: 'tc1', skill: 'run_prowler', state: 'output', chunk: 'public: true' },
      { type: 'skill', id: 'tc1', skill: 'run_prowler', state: 'success', exitCode: 0 },
    ]
    evs.forEach(e => r.record(e))
    expect(r.get('tc1')).toBe('Bucket public: true')
    expect(r.get('missing')).toBeUndefined()
  })
})

describe('evidenceFromArgs', () => {
  const reg = { get: (id: string) => (id === 'tc1' ? 'RAW OUTPUT' : undefined) }
  it('resolves a tool_output reference to a snapshotted excerpt', () => {
    expect(evidenceFromArgs({ tool_output: 'tc1' }, reg)).toEqual({ kind: 'tool_output', toolCallId: 'tc1', excerpt: 'RAW OUTPUT' })
  })
  it('returns null for an unresolvable tool_output reference', () => {
    expect(evidenceFromArgs({ tool_output: 'nope' }, reg)).toBeNull()
  })
  it('bounds the excerpt to EXCERPT_MAX', () => {
    const big = { get: () => 'x'.repeat(EXCERPT_MAX + 500) }
    const ev = evidenceFromArgs({ tool_output: 'tc1' }, big) as { excerpt: string }
    expect(ev.excerpt.length).toBe(EXCERPT_MAX)
  })
  it('builds a code_block from host + detail', () => {
    expect(evidenceFromArgs({ host: 's3://acme', detail: 'ACL public-read' }, reg)).toEqual({ kind: 'code_block', host: 's3://acme', detail: 'ACL public-read' })
  })
  it('returns null when no usable evidence args are present', () => {
    expect(evidenceFromArgs({ host: 's3://acme' }, reg)).toBeNull()   // detail missing
    expect(evidenceFromArgs({}, reg)).toBeNull()
  })
})

describe('computeVerified', () => {
  it('is true iff there is at least one evidence artifact', () => {
    expect(computeVerified([])).toBe(false)
    expect(computeVerified([{ kind: 'code_block', host: 'h', detail: 'd' }])).toBe(true)
  })
})

describe('normalizeSev', () => {
  it('maps case-insensitively and defaults to Medium', () => {
    expect(normalizeSev('high')).toBe('High')
    expect(normalizeSev('CRITICAL')).toBe('Critical')
    expect(normalizeSev(undefined)).toBe('Medium')
    expect(normalizeSev('bogus')).toBe('Medium')
  })
})
