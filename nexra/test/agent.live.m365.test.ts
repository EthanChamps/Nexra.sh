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
