import type { AgentEvent, AgentSendRequest, AgentInstallRequest } from './agent.types'
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export async function runSend(req: AgentSendRequest, emit: (e: AgentEvent) => void): Promise<void> {
  await wait(450)
  // phaseLabel is empty on a brand-new chat's first message (focus not yet
  // inferred); drop the phase clause rather than emit a doubled space.
  const scope = req.phaseLabel ? 'for the ' + req.phaseLabel + ' phase' : 'across this engagement'
  emit({ type: 'text', text: 'On it — running a targeted check ' + scope + '.' })
  emit({ type: 'tool_call', state: 'running', toolName: req.primaryTool, command: req.primaryTool + ' --scope in-scope --profile quick' })
  await wait(1500)
  emit({ type: 'tool_call', state: 'success', toolName: req.primaryTool, command: req.primaryTool + ' --scope in-scope --profile quick', duration: '7.4s', output: 'Completed 128 checks · 3 notable · 0 errors' })
  await wait(500)
  emit({ type: 'text', text: 'Done — the notable items are logged in the findings panel on the right. Want me to dig into any of them?' })
  emit({ type: 'done' })
}

export async function runInstall(req: AgentInstallRequest, emit: (e: AgentEvent) => void): Promise<void> {
  emit({ type: 'tool_call', state: 'running', toolName: req.toolName, command: req.installCmd || ('install ' + req.toolName) })
  await wait(1400)
  emit({ type: 'tool_call', state: 'success', toolName: req.toolName, command: req.installCmd || ('install ' + req.toolName), duration: '11.2s', output: 'Collecting ' + req.toolName + '...\nSuccessfully installed ' + req.toolName })
  emit({ type: 'text', text: req.toolName + ' installed and now available in this chat. I can re-run the analysis whenever you are ready.' })
  emit({ type: 'done' })
}
