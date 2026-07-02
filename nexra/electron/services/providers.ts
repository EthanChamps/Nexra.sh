import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

export interface ProviderConfig {
  provider: 'anthropic' | 'ollama' | 'openai' | 'google'
  model: string
  baseUrl?: string
  apiKey?: string
}

// Resolves runtime provider settings into an AI SDK model. M3a wires Anthropic
// (cloud, keyed) and Ollama (local, keyless, OpenAI-compatible at baseUrl/v1).
export function resolveModel(cfg: ProviderConfig): LanguageModel {
  if (cfg.provider === 'anthropic') {
    if (!cfg.apiKey) throw new Error('No API key set for Anthropic')
    return createAnthropic({ apiKey: cfg.apiKey })(cfg.model)
  }
  if (cfg.provider === 'ollama') {
    const baseURL = (cfg.baseUrl ?? 'http://localhost:11434') + '/v1'
    return createOpenAICompatible({ name: 'ollama', baseURL })(cfg.model)
  }
  throw new Error(`Provider "${cfg.provider}" is not wired in M3a`)
}
