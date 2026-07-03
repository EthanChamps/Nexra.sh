import { describe, it, expect } from 'vitest'
import { friendlySkillCalls } from '../src/lib/friendlySkillCalls'

describe('friendlySkillCalls', () => {
  it('replaces a known skill call with its friendly label', () => {
    const input = 'Please provide the Account IDs and Regions. SKILL_CALL[request_inputs|items=AWS_ACCOUNT_ID:Account ID:s:r]'
    expect(friendlySkillCalls(input)).toBe('Please provide the Account IDs and Regions. → Requesting inputs')
  })

  it('replaces multiple calls in the same message', () => {
    const input = 'SKILL_CALL[log_finding|title=X|sev=High] then SKILL_CALL[attach_evidence|finding=f1|tool_output=t1]'
    expect(friendlySkillCalls(input)).toBe('→ Logging finding then → Attaching evidence')
  })

  it('falls back to a humanized name for an unmapped skill', () => {
    expect(friendlySkillCalls('SKILL_CALL[some_new_skill|arg=1]')).toBe('→ some new skill')
  })

  it('leaves text with no skill call unchanged', () => {
    expect(friendlySkillCalls('Just a normal reply, no calls here.')).toBe('Just a normal reply, no calls here.')
  })

  it('does not touch an incomplete (still-streaming) call missing its closing bracket', () => {
    const input = 'Working on it. SKILL_CALL[request_inp'
    expect(friendlySkillCalls(input)).toBe(input)
  })

  it('labels the bracketless colon form the model sometimes emits', () => {
    const input = 'To begin the scan.\nSKILL_CALL:request_inputs|items=AWS_ACCESS_KEY_ID:Access Key ID:s:r'
    expect(friendlySkillCalls(input)).toBe('To begin the scan.\n→ Requesting inputs')
  })
})
