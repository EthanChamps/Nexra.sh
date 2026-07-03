import type { Evidence, Severity } from './store.types'
import type { AgentEvent } from './agent.types'

// Cap on a snapshotted tool-output excerpt so evidence stays reviewable and the
// DB stays small. (Spec §11.)
export const EXCERPT_MAX = 2000

// Accumulates skill stdout per invocation id so a later evidence reference
// (tool_output=<id>) resolves to real captured output. Fed every AgentEvent the
// loop emits; only skill `output` chunks are retained.
export function createRunRegistry() {
  const out = new Map<string, string>()
  return {
    record(e: AgentEvent): void {
      if (e.type === 'skill' && e.state === 'output' && e.chunk) out.set(e.id, (out.get(e.id) ?? '') + e.chunk)
    },
    get(id: string): string | undefined { return out.get(id) },
  }
}

// Build an Evidence artifact from parsed SKILL_CALL args. A tool_output ref must
// resolve against the registry (else null → finding stays unverified); a
// code_block needs both host and detail.
export function evidenceFromArgs(args: Record<string, string>, registry: { get(id: string): string | undefined }): Evidence | null {
  if (args.tool_output) {
    const captured = registry.get(args.tool_output)
    if (captured == null) return null
    return { kind: 'tool_output', toolCallId: args.tool_output, excerpt: captured.slice(0, EXCERPT_MAX) }
  }
  if (args.host && args.detail) return { kind: 'code_block', host: args.host, detail: args.detail }
  return null
}

export function computeVerified(evidence: Evidence[]): boolean {
  return evidence.length > 0
}

const SEVS: Severity[] = ['Critical', 'High', 'Medium', 'Low']
export function normalizeSev(s: string | undefined): Severity {
  return SEVS.find(v => v.toLowerCase() === (s ?? '').toLowerCase()) ?? 'Medium'
}
