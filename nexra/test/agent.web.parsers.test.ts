import { describe, it, expect } from 'vitest'
import { parseNucleiJsonl, summarizeSkill } from '../electron/services/agent.web'

const NUCLEI = [
  JSON.stringify({ 'template-id': 'git-config', info: { name: 'Exposed .git', severity: 'critical' }, host: 'app.acme.com', 'matched-at': 'https://app.acme.com/.git/config' }),
  JSON.stringify({ 'template-id': 'missing-csp', info: { name: 'Missing CSP', severity: 'medium' }, host: 'app.acme.com', 'matched-at': 'https://app.acme.com/login' }),
].join('\n')

describe('parseNucleiJsonl', () => {
  it('reduces JSONL to a summary + severity-mapped candidates', () => {
    const { summary, candidates } = parseNucleiJsonl(NUCLEI)
    expect(candidates).toHaveLength(2)
    expect(candidates[0]).toMatchObject({ sev: 'Critical', host: 'app.acme.com' })
    expect(candidates[0].detail).toContain('https://app.acme.com/.git/config')
    expect(summary).toMatch(/2 finding/i)
    expect(summary).toMatch(/critical/i)
  })
  it('tolerates blank lines and junk', () => {
    expect(parseNucleiJsonl('\n{bad}\n').candidates).toEqual([])
  })
})

describe('summarizeSkill', () => {
  it('dispatches nuclei output to the nuclei parser', () => {
    expect(summarizeSkill('web_scan', NUCLEI).candidates).toHaveLength(2)
  })
  it('unknown skill gives a generic summary and no candidates', () => {
    const r = summarizeSkill('web_probe', '{"url":"https://app.acme.com","status_code":200,"title":"Acme"}')
    expect(r.candidates).toEqual([])
    expect(r.summary.length).toBeGreaterThan(0)
  })
})
