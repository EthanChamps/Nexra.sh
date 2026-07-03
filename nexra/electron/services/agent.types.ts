import type { Severity, ToolState, Evidence, InputRequestItem } from './store.types'

// Lifecycle of one typed-skill invocation (M3b). `denied` = scope refused it
// (never spawned); `blocked` = a required credential is missing (never spawned,
// paired with an input_request); `output` carries a stdout chunk from the CHILD
// process only — never its environment; `unavailable` = the tool binary isn't
// installed (spawn ENOENT) — carries an `installCmd`; `error` = the spawn failed
// for some other reason. A missing binary is NOT `success` — the model must be
// able to tell the operator to install it rather than claim the scan ran.
export type SkillState = 'running' | 'output' | 'success' | 'denied' | 'blocked' | 'unavailable' | 'error'

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call'; state: ToolState; toolName: string; command?: string; output?: string; duration?: string; reason?: string; installCmd?: string }
  | { type: 'skill'; id: string; skill: string; state: SkillState; command?: string; chunk?: string; message?: string; exitCode?: number; duration?: string; installCmd?: string }
  | { type: 'input_request'; requestId: string; items: InputRequestItem[] }
  | { type: 'scope_request'; engagementId: string }
  | { type: 'finding'; id: string; title: string; sev: Severity; phase: string; time: string; rationale: string; evidence: Evidence[]; verified: boolean }
  | { type: 'error'; message: string }
  | { type: 'done' }

export interface AgentSendRequest {
  chatId: string; engagementType: string; phaseLabel: string; primaryTool: string; text: string
  history: { role: 'user' | 'assistant'; content: string }[]
  companyId?: string; engagementId?: string
}
export interface AgentInstallRequest { chatId: string; toolName: string; installCmd?: string }
export interface AgentTitleRequest { engagementType: string; text: string }
