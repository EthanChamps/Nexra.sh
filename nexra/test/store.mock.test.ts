import { describe, it, expect } from 'vitest'
import { buildSnapshot } from '../electron/services/store.mock'

describe('store mock seed', () => {
  it('seeds three companies', () => {
    const s = buildSnapshot()
    expect(s.companies.map(c => c.name)).toEqual(['Acme Corp', 'Contoso Ltd', 'Globex Systems'])
  })
  it('Acme has an IAM chat with a Critical finding', () => {
    const acme = buildSnapshot().companies[0]
    const aws = acme.engagements.find(e => e.type === 'aws')!
    const iam = aws.chats.find(c => c.phaseId === 'iam')!
    expect(iam.findings[0].sev).toBe('Critical')
  })
  it('one engagement is deliberately empty (no chats)', () => {
    const all = buildSnapshot().companies.flatMap(c => c.engagements)
    expect(all.some(e => e.chats.length === 0)).toBe(true)
  })
  it('exposes all six review types', () => {
    expect(Object.keys(buildSnapshot().types).sort()).toEqual(['aws','azure','external','internal','m365','web'])
  })
})
