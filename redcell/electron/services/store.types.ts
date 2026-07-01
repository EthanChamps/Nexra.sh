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
export type MessageKind = 'text' | 'tool'
export type ToolState = 'running' | 'success' | 'unavailable'

export interface Message {
  id: string; role: MessageRole; kind: MessageKind
  content?: string
  toolName?: string; command?: string; output?: string; duration?: string
  reason?: string; installCmd?: string; state?: ToolState
}

export interface Finding { title: string; sev: Severity; phase: string; time: string }

export interface Chat {
  id: string; name: string; phaseId: string; color: string
  messages: Message[]; findings: Finding[]; tools: ToolAvailability[]
}

export interface Engagement {
  id: string; type: ReviewTypeId; name: string; status: EngagementStatus
  updated: string; linear: boolean; phases: Phase[]; scope: ScopeRow[]; chats: Chat[]
}

export interface Company { id: string; name: string; updated: string; engagements: Engagement[] }

export interface Snapshot { companies: Company[]; types: Record<ReviewTypeId, ReviewTypeConfig> }
