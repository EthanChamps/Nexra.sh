import { describe, it, expect, vi } from 'vitest'

const generateText = vi.fn()
vi.mock('ai', () => ({ generateText: (o: any) => generateText(o) }))
vi.mock('../electron/services/providers', () => ({ resolveModel: () => ({ tag: 'fake-model' }) }))

import { runTitle } from '../electron/services/agent.title'
import type { AgentTitleRequest } from '../electron/services/agent.types'
import type { ProviderConfig } from '../electron/services/providers'

const req: AgentTitleRequest = { engagementType: 'aws', text: 'review iam roles for privilege escalation' }
const cfg: ProviderConfig = { provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'sk-1' }

// No shared beforeEach here: Vitest 2.1's unhandled-rejection detector false-
// positives on a rejected mock when a beforeEach hook is present in the same
// suite, even though the rejection is correctly caught (confirmed by hand).
// Each test clears the mock inline instead.

describe('runTitle', () => {
  it('sends an engagement-typed system prompt and the message as the user turn', async () => {
    generateText.mockClear()
    generateText.mockResolvedValue({ text: 'Review IAM Privilege Escalation' })
    await runTitle(req, cfg)
    const call = generateText.mock.calls[0][0]
    expect(call.system).toContain('aws')
    expect(call.messages).toEqual([{ role: 'user', content: 'review iam roles for privilege escalation' }])
    expect(call.maxOutputTokens).toBe(20)
  })

  it('trims and strips wrapping quotes', async () => {
    generateText.mockClear()
    generateText.mockResolvedValue({ text: '  "Review IAM Privilege Escalation"  ' })
    const title = await runTitle(req, cfg)
    expect(title).toBe('Review IAM Privilege Escalation')
  })

  it('caps an overlong title at 48 characters', async () => {
    generateText.mockClear()
    generateText.mockResolvedValue({ text: 'x'.repeat(80) })
    const title = await runTitle(req, cfg)
    expect(title).toHaveLength(48)
  })

  it('propagates a provider error', async () => {
    generateText.mockClear()
    generateText.mockRejectedValue(new Error('401 unauthorized'))
    await expect(runTitle(req, cfg)).rejects.toThrow('401 unauthorized')
  })
})
