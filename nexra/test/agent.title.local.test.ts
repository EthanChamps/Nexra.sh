import { describe, it, expect, vi } from 'vitest'

// The model call must NOT happen for the local (ollama) provider — titling a
// chat should never ship the operator's first message off this machine.
const generateText = vi.fn(async (..._a: any[]) => ({ text: 'SHOULD NOT BE CALLED' }))
vi.mock('ai', () => ({ generateText: (...a: any[]) => generateText(...a) }))
vi.mock('../electron/services/providers', () => ({ resolveModel: () => ({ tag: 'fake' }) }))

import { runTitle } from '../electron/services/agent.title'

describe('runTitle — local titling for the local model', () => {
  it('derives a title locally for ollama without calling the model', async () => {
    generateText.mockClear()
    const t = await runTitle({ chatId: 'c', engagementType: 'web', text: 'Assess https://app.acme.com login for SQLi' } as any,
      { provider: 'ollama', model: 'gemma3:27b' })
    expect(generateText).not.toHaveBeenCalled()
    expect(t.length).toBeGreaterThan(0)
    expect(t.length).toBeLessThanOrEqual(48)
  })

  it('still uses the model for a cloud provider', async () => {
    generateText.mockClear()
    generateText.mockResolvedValueOnce({ text: 'Acme Web SQLi Review' })
    const t = await runTitle({ chatId: 'c', engagementType: 'web', text: 'hello' } as any,
      { provider: 'anthropic', model: 'claude', apiKey: 'x' })
    expect(generateText).toHaveBeenCalledOnce()
    expect(t).toBe('Acme Web SQLi Review')
  })
})
