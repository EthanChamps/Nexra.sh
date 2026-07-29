import { generateText, Output } from 'ai'
import type { z } from 'zod'
import { parseStructuredAction, type WebAction } from './agent.web'

export interface DecideDeps {
  // Injected model call. Default wiring (defaultGenerate) passes the AI SDK
  // generateText bound with Output.object(schema) so Ollama constrains the
  // decode. Returns the raw text the model produced.
  generate: (opts: { system: string; messages: { role: 'user' | 'assistant'; content: string }[]; signal: AbortSignal }) => Promise<{ text: string }>
  system: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  phaseLabel: string
  signal: AbortSignal
}

// One schema-constrained decision. The schema is phase-scoped, so an out-of-phase
// action fails validation and returns null; the caller then feeds a one-line
// correction and re-decides (the bounded repair path).
export async function decideWebAction(deps: DecideDeps): Promise<WebAction | null> {
  const { text } = await deps.generate({ system: deps.system, messages: deps.messages, signal: deps.signal })
  return parseStructuredAction(text, deps.phaseLabel)
}

// Real generate: force schema-constrained JSON via experimental_output. Over the
// OpenAI-compatible Ollama path this maps to response_format json_schema. If the
// provider ignores it, decideWebAction still returns null on invalid output and
// the caller repairs — so this is a reliability boost, not a correctness gate.
//
// reasoningEffort:'none' disables thinking on hybrid-reasoning local models
// (e.g. Qwen3.5). The action decision is a below-the-LLM classification, not a
// task that benefits from chain-of-thought — and on the OpenAI-compat endpoint
// Ollama emits reasoning inline unless told otherwise, which pollutes the JSON
// the parser expects. The option is namespaced to `ollama`, so cloud providers
// (Anthropic) ignore it. Verified: this maps to the `reasoning_effort` body
// field, the one switch Ollama honors over /v1/chat/completions.
export function defaultGenerate(model: any, schema: z.ZodType) {
  return async (opts: { system: string; messages: any[]; signal: AbortSignal }) => {
    const r = await generateText({
      model,
      system: opts.system,
      messages: opts.messages,
      abortSignal: opts.signal,
      experimental_output: Output.object({ schema }),
      providerOptions: { ollama: { reasoningEffort: 'none' } },
    })
    return { text: JSON.stringify((r as any).experimental_output ?? {}) }
  }
}
