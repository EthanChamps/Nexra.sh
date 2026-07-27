import { describe, it, expect } from 'vitest'
import { WEB_PHASES, allowedActionsForPhase, parseStructuredAction } from '../electron/services/agent.web'

describe('web methodology', () => {
  it('orders phases and scopes skills to each', () => {
    expect(WEB_PHASES.map(p => p.id)).toEqual(['map', 'discover', 'scan', 'verify', 'report'])
    expect(WEB_PHASES.find(p => p.id === 'scan')!.skills).toContain('web_scan')
    expect(WEB_PHASES.find(p => p.id === 'verify')!.skills).toContain('web_sqli')
    expect(WEB_PHASES.find(p => p.id === 'scan')!.skills).not.toContain('web_sqli')
  })
  it('allowed actions include phase skills + control actions', () => {
    const a = allowedActionsForPhase('Scan')
    expect(a).toEqual(expect.arrayContaining(['web_scan', 'log_finding', 'checkpoint', 'done']))
    expect(a).not.toContain('web_sqli')
  })
})

describe('parseStructuredAction', () => {
  it('accepts a valid in-phase action', () => {
    const a = parseStructuredAction(JSON.stringify({ action: 'web_scan', url: 'https://app.acme.com' }), 'Scan')
    expect(a).toMatchObject({ action: 'web_scan', url: 'https://app.acme.com' })
  })
  it('rejects an out-of-phase action', () => {
    expect(parseStructuredAction(JSON.stringify({ action: 'web_sqli', url: 'x' }), 'Scan')).toBeNull()
  })
  it('rejects malformed JSON', () => {
    expect(parseStructuredAction('{not json', 'Scan')).toBeNull()
  })
})
