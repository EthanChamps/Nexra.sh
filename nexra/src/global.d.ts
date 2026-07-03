import type { Snapshot, Secret, SecretField, EngagementScope, Finding, ProjectScope, ScopeItem, ScopeItemType } from '../electron/services/store.types'
import type { AgentEvent, AgentSendRequest, AgentInstallRequest, AgentTitleRequest } from '../electron/services/agent.types'
import type { ShellId, ShellTab, ShellCreateResult } from '../electron/services/shell.types'

export interface NexraApi {
  platform: NodeJS.Platform
  store: {
    snapshot(): Promise<Snapshot>
    save(companies: import('../electron/services/store.types').Company[]): Promise<{ success: boolean; error?: string }>
    deleteCompany(id: string): Promise<void>
    deleteChat(id: string): Promise<void>
    coverage(engagementId: string): Promise<{ phaseId: string; status: string }[]>
    memory(engagementId: string): Promise<{ kind: string; content: string; chatId?: string; time: string }[]>
  }
  agent: {
    send(req: AgentSendRequest, onEvent: (e: AgentEvent) => void): Promise<void>
    title(req: AgentTitleRequest): Promise<string>
    install(req: AgentInstallRequest, onEvent: (e: AgentEvent) => void): Promise<void>
    cancel(chatId: string): Promise<void>
  }
  settings: {
    get(): Promise<{ provider: string; model: string; baseUrl: string; hasKey: boolean }>
    set(partial: { provider?: string; model?: string; baseUrl?: string }): Promise<void>
    setKey(provider: string, plaintext: string): Promise<void>
  }
  // Credential vault (M3b). list/create/delete deal in METADATA only; fill/tie
  // send plaintext renderer→main once and it is never returned.
  secrets: {
    list(companyId: string): Promise<Secret[]>
    create(input: { companyId: string; name: string; fields: SecretField[]; createdBy?: 'operator' | 'agent' }): Promise<Secret>
    fill(id: string, values: Record<string, string>): Promise<Secret>
    tie(id: string, aliasOf: string): Promise<Secret>
    delete(id: string): Promise<void>
    fulfillPending(id: string, values: Record<string, string>): Promise<{ success: boolean; error?: string }>
  }
  // Agent-requested inputs (M3d) — plaintext travels renderer→main once (mirrors secrets).
  inputs: {
    fulfill(companyId: string, key: string, value: string, sensitive: boolean): Promise<{ success: boolean; error?: string }>
  }
  scope: {
    get(engagementId: string): Promise<EngagementScope | undefined>
    set(engagementId: string, scope: EngagementScope): Promise<void>
    setAndValidate(engagementId: string, scope: EngagementScope): Promise<{ success: boolean; error?: string }>
  }
  projectScope: {
    get(companyId: string): Promise<ProjectScope>
    add(companyId: string, input: { type: ScopeItemType; value: string; source: 'user' | 'agent' }): Promise<ScopeItem>
    remove(companyId: string, id: string): Promise<void>
    setNotes(companyId: string, notes: string): Promise<void>
  }
  findings: {
    list(chatId: string): Promise<Finding[]>
  }
  shell: {
    tabs(): Promise<ShellTab[]>
    // sessionId is opaque: a bare ShellId, or `${companyId}:${ShellId}` when a
    // companyId is supplied (per-project shell).
    create(shell: ShellId, cols: number, rows: number, companyId?: string): Promise<ShellCreateResult>
    write(sessionId: string, data: string): Promise<void>
    resize(sessionId: string, cols: number, rows: number): Promise<void>
    kill(sessionId: string): Promise<void>
    onData(sessionId: string, cb: (data: string) => void): () => void
  }
}
declare global { interface Window { nexra: NexraApi } }
