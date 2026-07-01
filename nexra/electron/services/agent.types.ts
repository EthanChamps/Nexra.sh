import type { Severity, ToolState } from './store.types'

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; state: ToolState; toolName: string; command?: string; output?: string; duration?: string; reason?: string; installCmd?: string }
  | { type: 'finding'; title: string; sev: Severity; phase: string; time: string }
  | { type: 'done' }

export interface AgentSendRequest { chatId: string; engagementType: string; phaseLabel: string; primaryTool: string; text: string }
export interface AgentInstallRequest { chatId: string; toolName: string; installCmd?: string }
