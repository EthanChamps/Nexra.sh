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

// Best-practice check for the split-compute setup (model on separate hardware):
// prompts carry target URLs and finding summaries, so shipping them in cleartext
// to a remote model exposes engagement data on the network. Returns a warning
// string when the model endpoint is plain http to a non-loopback host, else null.
// Loopback http is fine — that covers a local model or a WireGuard/SSH tunnel
// that terminates on localhost. The caller surfaces the warning; we don't hard-
// block, so an operator mid-engagement is never locked out.
export function modelTransportWarning(cfg: ProviderConfig): string | null {
  if (cfg.provider !== 'ollama') return null
  const base = cfg.baseUrl ?? 'http://localhost:11434'
  let u: URL
  try { u = new URL(base) } catch { return `Model base URL is not a valid URL: ${base}` }
  const host = u.hostname.toLowerCase()
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost')
  if (loopback || u.protocol === 'https:') return null
  return `Prompts (target URLs, finding summaries) would be sent in cleartext over the network to the model at ${host}. Use HTTPS or a WireGuard/SSH tunnel to localhost so engagement data isn't exposed.`
}
