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

// Derive a title locally, without any model call — used for the local provider
// so titling never ships the operator's first message off this machine. Takes
// the first non-empty line, collapses whitespace, drops any URL (identifying and
// not title-worthy), and Title-Cases up to six words.
export function localTitle(text: string): string {
  const line = (text.split('\n').map(l => l.trim()).find(Boolean) ?? '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  const words = line.split(' ').filter(Boolean).slice(0, 6)
  const cased = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ').slice(0, 48).trim()
  return cased || 'New Chat'
}

// One short completion, not a chat turn — auto-titles a new chat from its
// first user message. For the local (ollama) provider we title on-device via
// localTitle so nothing is sent to the model. Errors (missing key, network,
// provider) propagate to the caller, which falls back to a deterministic
// heuristic (see ipc.ts) — as does an empty/unusable result (e.g. a trivial
// "hi" can yield nothing after cleanup), so the chat is never left blank.
export async function runTitle(req: AgentTitleRequest, cfg: ProviderConfig): Promise<string> {
  if (cfg.provider === 'ollama') return localTitle(req.text)
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
