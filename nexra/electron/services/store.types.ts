export type ReviewTypeId = 'aws' | 'azure' | 'm365' | 'internal' | 'external'
export type Severity = 'Critical' | 'High' | 'Medium' | 'Low'
export type EngagementStatus = 'In Progress' | 'Complete'

export interface Phase { id: string; label: string }
export interface ToolAvailability { name: string; available: boolean }
export interface ScopeRow { label: string; value: string }

export interface ReviewTypeConfig {
  label: string; short: string; linear: boolean
  phases: Phase[]; tools: ToolAvailability[]; scope: ScopeRow[]
}

export type MessageRole = 'user' | 'assistant'
export type MessageKind = 'text' | 'tool' | 'request'
export type ToolState = 'running' | 'success' | 'unavailable'

export interface Message {
  id: string; role: MessageRole; kind: MessageKind
  content?: string
  toolName?: string; command?: string; output?: string; duration?: string
  reason?: string; installCmd?: string; state?: ToolState
  // request cards (M3d): the agent asks the operator for inputs or scope
  requestKind?: 'inputs' | 'scope'; requestId?: string; items?: InputRequestItem[]; engagementId?: string
}

// A checkable artifact behind a finding (M3c). `tool_output` references a
// captured skill run; `code_block` is the agent's structured statement of the
// affected host + issue; `image` is typed now, wired with the web/pentest
// verticals later.
export type Evidence =
  | { kind: 'tool_output'; toolCallId: string; excerpt: string }
  | { kind: 'code_block'; host: string; detail: string }
  | { kind: 'image' }

export interface Finding {
  id: string
  title: string
  sev: Severity
  phase: string
  time: string
  rationale: string        // why this severity — the model's reasoning
  evidence: Evidence[]     // ≥1 resolving artifact required to be verified
  verified: boolean        // computed in main; the model cannot set it
}

export interface Chat {
  id: string; name: string; phaseId: string; color: string
  messages: Message[]; findings: Finding[]; tools: ToolAvailability[]
}

// Typed, ENFORCED scope for an engagement (distinct from the freeform `scope`
// display rows below). `mode:'all'` = the agent may touch anything the injected
// credential can reach; `mode:'allowlist'` = only the listed accounts/regions.
export interface EngagementScope {
  mode: 'all' | 'allowlist'
  accounts: string[]
  regions: string[]
}

export interface Engagement {
  id: string; type: ReviewTypeId; name: string; status: EngagementStatus
  updated: string; linear: boolean; phases: Phase[]; scope: ScopeRow[]; chats: Chat[]
  enforcement?: EngagementScope
}

// A per-project credential slot. This is the METADATA the renderer/agent may
// see — it never carries a plaintext value. Values live encrypted, keyed by
// `${id}:${envVar}`, and are decrypted only in the main process at spawn time.
export interface SecretField { envVar: string }
export interface Secret {
  id: string
  companyId: string                 // per-project (Company = client)
  name: string                      // reference the agent uses, e.g. "aws-prod"
  fields: SecretField[]             // WHICH env vars this secret populates
  status: 'pending' | 'filled'
  aliasOf?: string                  // "tie to existing" → id of another Secret
  createdBy: 'operator' | 'agent'
  sensitive?: boolean                // absent = sensitive (legacy default); false = plain config value
}

// One input the agent asks the operator to provide (M3d). `key` is the env var
// the value injects as; `sensitive` masks + encrypts it; `required` gates the
// agent's auto-resume. Defined here (not agent.types) to avoid a type cycle —
// both the event layer and the renderer message use it.
export interface InputRequestItem { key: string; label: string; sensitive: boolean; required: boolean }

export interface Company { id: string; name: string; updated: string; engagements: Engagement[] }

export interface Snapshot { companies: Company[]; types: Record<ReviewTypeId, ReviewTypeConfig> }
