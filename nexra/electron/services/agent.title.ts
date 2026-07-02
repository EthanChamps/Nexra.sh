import { generateText } from 'ai'
import type { AgentTitleRequest } from './agent.types'
import { resolveModel, type ProviderConfig } from './providers'

function systemPrompt(engagementType: string): string {
  return (
    `Generate a short title (3-6 words) summarizing what this ${engagementType} ` +
    `security-consulting chat will be about, based on the user's first message. ` +
    `Title Case, no quotes, no trailing punctuation, no explanation — respond with only the title.`
  )
}

// One short completion, not a chat turn — auto-titles a new chat from its
// first user message. Errors (missing key, network, provider) propagate to
// the caller, which falls back to a deterministic heuristic (see ipc.ts) —
// as does an empty/unusable result (e.g. a trivial "hi" can yield nothing
// after cleanup), so the chat is never left permanently blank.
export async function runTitle(req: AgentTitleRequest, cfg: ProviderConfig): Promise<string> {
  const model = resolveModel(cfg)
  const { text } = await generateText({
    model,
    system: systemPrompt(req.engagementType),
    messages: [{ role: 'user', content: req.text }],
    maxOutputTokens: 20,
  })
  const cleaned = text.trim().replace(/^["']+|["']+$/g, '').slice(0, 48)
  if (!cleaned) throw new Error('Model returned an empty title')
  return cleaned
}
