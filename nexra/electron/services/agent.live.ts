import { streamText } from 'ai'
import type { AgentEvent, AgentSendRequest } from './agent.types'
import { resolveModel, type ProviderConfig } from './providers'

function systemPrompt(engagementType: string, phaseLabel: string): string {
  const phase = phaseLabel ? ` Its current phase is: ${phaseLabel}.` : ''
  return (
    `You are Nexra, an AI assistant embedded in a security consultant's console, ` +
    `helping with a ${engagementType} engagement.${phase} ` +
    `Be precise and practical. You cannot execute tools yet — answer conversationally ` +
    `and help the consultant plan and interpret their work.`
  )
}

// Streams a live model response for one chat turn. Emits one text_delta per
// chunk, then done. On failure emits error (no done). An abort is not an error:
// it finalizes with done.
export async function runSend(
  req: AgentSendRequest,
  cfg: ProviderConfig,
  emit: (e: AgentEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  let model
  try {
    model = resolveModel(cfg)
  } catch (err) {
    emit({ type: 'error', message: (err as Error).message })
    return
  }
  const messages = [...req.history, { role: 'user' as const, content: req.text }]
  try {
    const result = streamText({ model, system: systemPrompt(req.engagementType, req.phaseLabel), messages, abortSignal: signal })
    for await (const delta of result.textStream) emit({ type: 'text_delta', delta })
    emit({ type: 'done' })
  } catch (err) {
    if (signal.aborted || (err as Error)?.name === 'AbortError') { emit({ type: 'done' }); return }
    emit({ type: 'error', message: (err as Error).message })
  }
}
