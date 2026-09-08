import { describe, it, expect, vi } from 'vitest'

const anthropicFactory = vi.fn((_opts: any) => vi.fn((model: string) => ({ tag: 'anthropic', model })))
const compatFactory = vi.fn((_opts: any) => vi.fn((model: string) => ({ tag: 'ollama', model })))
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: (o: any) => anthropicFactory(o) }))
vi.mock('@ai-sdk/openai-compatible', () => ({ createOpenAICompatible: (o: any) => compatFactory(o) }))

import { resolveModel } from '../electron/services/providers'

describe('resolveModel', () => {
  it('builds an Anthropic model with the api key', () => {
    const m = resolveModel({ provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'sk-1' }) as any
    expect(anthropicFactory).toHaveBeenCalledWith({ apiKey: 'sk-1' })
    expect(m).toEqual({ tag: 'anthropic', model: 'claude-opus-4-8' })
  })
  it('builds an Ollama model against baseUrl + /v1, no key', () => {
    const m = resolveModel({ provider: 'ollama', model: 'llama3.3', baseUrl: 'http://localhost:11434' }) as any
    expect(compatFactory).toHaveBeenCalledWith({ name: 'ollama', baseURL: 'http://localhost:11434/v1', supportsStructuredOutputs: true })
    expect(m).toEqual({ tag: 'ollama', model: 'llama3.3' })
  })
  it('throws for anthropic with no key', () => {
    expect(() => resolveModel({ provider: 'anthropic', model: 'claude-opus-4-8' })).toThrow(/api key/i)
  })
  it('throws for a provider not wired in M3a', () => {
    expect(() => resolveModel({ provider: 'openai', model: 'gpt-5.1' })).toThrow(/not.*M3a|not wired/i)
  })
})
