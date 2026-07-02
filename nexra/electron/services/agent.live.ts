import { streamText } from 'ai'
import type { AgentEvent, AgentSendRequest } from './agent.types'
import { resolveModel, type ProviderConfig } from './providers'
import { runSkill, AWS_SKILLS, type RunDeps, type SkillInvocation } from './agent.tools'
import { getScope } from './scope'
import { hasFilledSecret, injectEnv } from './secrets.vault'

interface DetectedSkill { name: string; args: Record<string, string> }

function parseSkillCalls(text: string): DetectedSkill[] {
  const regex = /SKILL_CALL\[([a-z_]+)\|([^\]]+)\]/g
  const skills: DetectedSkill[] = []
  let match
  while ((match = regex.exec(text)) !== null) {
    const name = match[1]
    const argsStr = match[2]
    const args: Record<string, string> = {}
    for (const pair of argsStr.split('|')) {
      const [k, v] = pair.split('=')
      if (k && v) args[k] = v
    }
    skills.push({ name, args })
  }
  return skills
}

function systemPrompt(engagementType: string, phaseLabel: string): string {
  const phase = phaseLabel ? ` Its current phase is: ${phaseLabel}.` : ''
  const skills = `
Available skills to invoke by writing SKILL_CALL[name|arg=value|...]:
- probe|account=ACCOUNT_ID|region=REGION: Probe AWS configuration (test skill).
- run_prowler|account=ACCOUNT_ID|region=REGION: Enumerate via Prowler.
- run_scoutsuite|account=ACCOUNT_ID: Enumerate via ScoutSuite.
- run_pmapper|account=ACCOUNT_ID: Enumerate via PMapper.`
  return (
    `You are Nexra, an AI assistant embedded in a security consultant's console, ` +
    `helping with a ${engagementType} engagement.${phase} ` +
    `Be precise and practical. ` +
    `When you need to gather data, invoke a skill by writing SKILL_CALL[...] in your output. ` +
    skills
  )
}

// Streams a live model response for one chat turn. Emits one text_delta per
// chunk, then done. On failure emits error (no done). An abort is not an error:
// it finalizes with done. In M3b, also parses and invokes any SKILL_CALL
// directives in the output.
export async function runSend(
  req: AgentSendRequest,
  cfg: ProviderConfig,
  emit: (e: AgentEvent) => void,
  signal: AbortSignal,
  companyId?: string,
  engagementId?: string,
): Promise<void> {
  let model
  try {
    model = resolveModel(cfg)
  } catch (err) {
    emit({ type: 'error', message: (err as Error).message })
    return
  }
  const firstUser = req.history.findIndex(m => m.role === 'user')
  const priorTurns = firstUser === -1 ? [] : req.history.slice(firstUser)
  const messages = [...priorTurns, { role: 'user' as const, content: req.text }]

  let assistantText = ''
  try {
    const result = streamText({ model, system: systemPrompt(req.engagementType, req.phaseLabel), messages, abortSignal: signal })
    for await (const delta of result.textStream) {
      assistantText += delta
      emit({ type: 'text_delta', delta })
    }
    emit({ type: 'done' })

    // Parse and invoke skills detected in the assistant's text (M3b)
    if (companyId && engagementId) {
      const detected = parseSkillCalls(assistantText)
      for (const d of detected) {
        const skillDef = d.name === 'probe' ? { name: 'probe', build: () => ({ command: process.execPath, args: ['-e', `process.stdout.write('probe-output')`] }) } : AWS_SKILLS[d.name]
        if (!skillDef) continue
        const inv: SkillInvocation = {
          skill: d.name, companyId, engagementId,
          account: d.args.account, region: d.args.region,
        }
        const deps: RunDeps = {
          getScope: (eid) => getScope(eid),
          injectEnv: (cid) => injectEnv(cid),
          hasFilledSecret: (cid, name) => hasFilledSecret(cid, name),
        }
        await runSkill(inv, skillDef as any, emit, deps)
      }
    }
  } catch (err) {
    if (signal.aborted || (err as Error)?.name === 'AbortError') { emit({ type: 'done' }); return }
    emit({ type: 'error', message: (err as Error).message })
  }
}
