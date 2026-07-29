import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'

// The web-action decision is a below-the-LLM classification, so thinking must be
// off on hybrid-reasoning local models (Qwen3.5 et al). defaultGenerate must pass
// reasoningEffort:'none' under the `ollama` provider namespace — which the
// openai-compatible provider maps to the `reasoning_effort` body field, the one
// switch Ollama honors over /v1/chat/completions. Namespacing keeps it a no-op
// for cloud providers.

const generateText = vi.fn(async (..._a: any[]) => ({ experimental_output: { action: 'web_probe', url: 'https://x' } }))
vi.mock('ai', () => ({
  generateText: (...a: any[]) => generateText(...a),
  Output: { object: (o: any) => ({ __output: o }) },
}))

import { defaultGenerate } from '../electron/services/agent.decide'

describe('defaultGenerate — thinking disabled on the local model', () => {
  const call = () => {
    const gen = defaultGenerate({ tag: 'fake' }, z.object({ action: z.string() }))
    return gen({ system: 'sys', messages: [{ role: 'user', content: 'hi' }], signal: new AbortController().signal })
  }

  it('passes reasoningEffort:none in the ollama provider namespace', async () => {
    generateText.mockClear()
    await call()
    expect(generateText).toHaveBeenCalledOnce()
    expect(generateText.mock.calls[0][0].providerOptions).toEqual({ ollama: { reasoningEffort: 'none' } })
  })

  it('still requests schema-constrained structured output', async () => {
    generateText.mockClear()
    await call()
    expect(generateText.mock.calls[0][0].experimental_output).toBeDefined()
  })

  it('returns empty JSON (→ bounded repair) when the model output fails schema validation', async () => {
    generateText.mockRejectedValueOnce(Object.assign(new Error('No object generated: response did not match schema'), { name: 'NoObjectGeneratedError' }))
    const gen = defaultGenerate({ tag: 'fake' }, z.object({ action: z.string() }))
    const r = await gen({ system: 's', messages: [], signal: new AbortController().signal })
    expect(r.text).toBe('{}')
  })

  it('rethrows on abort — a real cancel must not be swallowed as a bad decision', async () => {
    const ac = new AbortController(); ac.abort()
    generateText.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    const gen = defaultGenerate({ tag: 'fake' }, z.object({ action: z.string() }))
    await expect(gen({ system: 's', messages: [], signal: ac.signal })).rejects.toThrow()
  })
})
