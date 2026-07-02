import type { Snapshot } from '../electron/services/store.types'
import type { AgentEvent, AgentSendRequest, AgentInstallRequest } from '../electron/services/agent.types'
import type { ShellId, ShellTab, ShellCreateResult } from '../electron/services/shell.types'

export interface NexraApi {
  platform: NodeJS.Platform
  store: { snapshot(): Promise<Snapshot> }
  agent: {
    send(req: AgentSendRequest, onEvent: (e: AgentEvent) => void): Promise<void>
    install(req: AgentInstallRequest, onEvent: (e: AgentEvent) => void): Promise<void>
  }
  shell: {
    tabs(): Promise<ShellTab[]>
    create(shell: ShellId, cols: number, rows: number): Promise<ShellCreateResult>
    write(sessionId: ShellId, data: string): Promise<void>
    resize(sessionId: ShellId, cols: number, rows: number): Promise<void>
    kill(sessionId: ShellId): Promise<void>
    onData(sessionId: ShellId, cb: (data: string) => void): () => void
  }
}
declare global { interface Window { nexra: NexraApi } }
