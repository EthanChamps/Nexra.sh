import { describe, it, expect } from 'vitest'
import { systemPrompt } from '../electron/services/agent.live'
import { skillsForEngagement } from '../electron/services/agent.tools'

describe('systemPrompt is pack-aware', () => {
  it('an m365 engagement is offered ScubaGear and not AWS tools', () => {
    const p = systemPrompt('m365', 'Identity', skillsForEngagement('m365'))
    expect(p).toContain('run_scubagear')
    expect(p).not.toContain('run_prowler')
    expect(p).toContain('m365')
  })

  it('an aws engagement still lists Prowler', () => {
    const p = systemPrompt('aws', 'IAM', skillsForEngagement('aws'))
    expect(p).toContain('run_prowler')
    expect(p).not.toContain('run_scubagear')
  })
})

describe('M365 credential guidance — app-only cert, never username/password', () => {
  // Every phase of an M365 engagement must steer the model to the three
  // app-only inputs and away from an interactive login. Guidance is pack-level,
  // so it must appear regardless of which phase the prompt is built for.
  const M365_PHASES = ['Identity', 'Exchange', 'SharePoint', 'Compliance', '']

  for (const phase of M365_PHASES) {
    it(`names the three app-only inputs and forbids a password in the ${phase || '(no)'} phase`, () => {
      const p = systemPrompt('m365', phase, skillsForEngagement('m365'))
      // Requests exactly tenant id + app id + certificate.
      expect(p).toContain('M365_TENANT_ID')
      expect(p).toContain('M365_APP_ID')
      expect(p).toContain('M365_CERT')
      // Gives the model the exact request_inputs grammar to copy, so it can't
      // slip into a format that parses to zero items (which hangs the run).
      expect(p).toContain('SKILL_CALL[request_inputs|items=M365_TENANT_ID:')
      // Explicitly steers away from a username/password login.
      const lower = p.toLowerCase()
      expect(lower).toContain('never')
      expect(lower).toContain('username or password')
      // The prompt must not solicit a password field.
      expect(lower).not.toContain('password:')
    })
  }

  it('an aws engagement gets AWS credential guidance, not M365 vars', () => {
    const p = systemPrompt('aws', 'IAM', skillsForEngagement('aws'))
    expect(p).toContain('AWS_ACCESS_KEY_ID')
    expect(p).not.toContain('M365_CERT')
  })
})
