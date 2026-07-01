import type { Snapshot } from '../electron/services/store.types'
import type { AgentEvent, AgentSendRequest, AgentInstallRequest } from '../electron/services/agent.types'
import type { ShellId, ShellTab, ShellRunResult } from '../electron/services/shell.types'

export interface RedcellApi {
  store: { snapshot(): Promise<Snapshot> }
  agent: {
    send(req: AgentSendRequest, onEvent: (e: AgentEvent) => void): Promise<void>
    install(req: AgentInstallRequest, onEvent: (e: AgentEvent) => void): Promise<void>
  }
  shell: { tabs(): Promise<ShellTab[]>; run(shell: ShellId, raw: string): Promise<ShellRunResult>; prompt(shell: ShellId): Promise<{ stored: string; inline: string; color: string }> }
}
declare global { interface Window { redcell: RedcellApi } }
