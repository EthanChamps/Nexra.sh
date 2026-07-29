import { describe, it, expect, vi, beforeEach } from 'vitest'

// resolveModel must create the ollama provider with supportsStructuredOutputs so
// the AI SDK actually sends the json_schema response_format (Ollama honors it).
// Without it the schema is silently dropped — the model runs unconstrained.

const createOpenAICompatible = vi.fn((..._a: any[]) => (_id: string) => ({ tag: 'ollama-model' }))
vi.mock('@ai-sdk/openai-compatible', () => ({ createOpenAICompatible: (...a: any[]) => createOpenAICompatible(...a) }))
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: () => () => ({ tag: 'anthropic-model' }) }))
vi.mock('ai', () => ({ generateText: vi.fn() }))

import { resolveModel } from '../electron/services/providers'

describe('resolveModel — ollama structured outputs', () => {
  beforeEach(() => createOpenAICompatible.mockClear())

  it('enables supportsStructuredOutputs so the json schema is actually sent', () => {
    resolveModel({ provider: 'ollama', model: 'qwen3.5:9b', baseUrl: 'http://localhost:11434' })
    expect(createOpenAICompatible).toHaveBeenCalledWith(
      expect.objectContaining({ supportsStructuredOutputs: true, baseURL: 'http://localhost:11434/v1' }),
    )
  })
})
