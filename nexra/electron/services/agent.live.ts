import { streamText } from 'ai'
import { randomUUID } from 'node:crypto'
import type { AgentEvent, AgentSendRequest } from './agent.types'
import type { Finding, InputRequestItem } from './store.types'
import { resolveModel, type ProviderConfig } from './providers'
import { runSkill, skillsForEngagement, type RunDeps, type SkillInvocation, type SkillDef } from './agent.tools'
import { getScope } from './scope'
import { filledEnvVars, injectEnv } from './secrets.vault'
import { upsertFinding } from './store.sqlite'
import { setPhaseCoverage } from './store.memory'
import { createRunRegistry, evidenceFromArgs, computeVerified, normalizeSev } from './agent.findings'

const STEP_CAP = 6

interface DetectedSkill { name: string; args: Record<string, string> }

// Canonical grammar is SKILL_CALL[name|arg=value|...]. Models occasionally slip
// and emit the bracketless colon form SKILL_CALL:name|arg=value|... instead;
// accept that too (terminated by end of line) so a formatting deviation doesn't
// get silently dropped, which would end the turn with no skill run / input card
// and leave the run looking stuck.
function parseSkillCalls(text: string): DetectedSkill[] {
  const regex = /SKILL_CALL(?:\[([a-z_]+)\|([^\]]+)\]|:([a-z_]+)\|([^\n]+))/g
  const skills: DetectedSkill[] = []
  let match
  while ((match = regex.exec(text)) !== null) {
    const name = match[1] ?? match[3]
    const body = match[2] ?? match[4]
    const args: Record<string, string> = {}
    for (const pair of body.split('|')) {
      const eq = pair.indexOf('=')
      if (eq > 0) args[pair.slice(0, eq)] = pair.slice(eq + 1)
    }
    skills.push({ name, args })
  }
  return skills
}

// Decode the request_inputs `items=` arg: `KEY:LABEL:SENS:REQ;...`.
// SENS 's' (default) = sensitive; REQ 'r' (default) = required.
function parseInputItems(args: Record<string, string>): InputRequestItem[] {
  return (args.items ?? '').split(';').map(s => s.trim()).filter(Boolean).map(entry => {
    const [key, label, sens, req] = entry.split(':')
    return {
      key: (key ?? '').trim(),
      label: (label ?? key ?? '').trim(),
      sensitive: (sens ?? 's').trim() !== '-',
      required: (req ?? 'r').trim() !== '-',
    }
  }).filter(i => i.key)
}

export function systemPrompt(engagementType: string, phaseLabel: string, pack: Record<string, SkillDef>): string {
  const phase = phaseLabel ? ` Its current phase is: ${phaseLabel}.` : ''
  const packLines = Object.values(pack).filter(s => s.promptLine).map(s => `- ${s.promptLine}`).join('\n')
  const findingLines = [
    '- log_finding|title=TEXT|sev=Critical|High|Medium|Low|phase=TEXT|rationale=TEXT: Log a finding. Attach evidence in the SAME call with tool_output=SKILL_ID or host=HOST|detail=ISSUE.',
    '- attach_evidence|finding=FINDING_ID|tool_output=SKILL_ID  OR  |host=HOST|detail=ISSUE: Attach evidence. A finding is UNVERIFIED until evidence is attached.',
    '- request_inputs|items=KEY:LABEL:SENS:REQ;...: Ask the operator for credentials/config. SENS \'s\'=secret (default), \'-\'=not secret; REQ \'r\'=required (default), \'-\'=optional. Mark non-credentials (tenant, account id, region) as not-secret. Do NOT request values a skill derives from the credentials it already requires.',
  ].join('\n')
  // Pack-level credential guidance (same for every phase): tells the model
  // exactly what each skill authenticates from so it never invents a generic
  // login (e.g. asking for an M365 username/password the skill would ignore).
  const credHints = [...new Set(Object.values(pack).map(s => s.credentialHint).filter(Boolean))]
  const credBlock = credHints.length
    ? `\nCredentials — when a skill needs authentication, request_inputs EXACTLY the inputs named below and nothing else:\n${credHints.map(h => `- ${h}`).join('\n')}`
    : ''
  const skills = `\nAvailable skills — invoke by writing SKILL_CALL[name|arg=value|...]:\n${packLines}\n${findingLines}${credBlock}`
  return (
    `You are Nexra, an AI assistant embedded in a security consultant's console, ` +
    `helping with a ${engagementType} engagement.${phase} ` +
    `Be precise and practical. Every finding you log MUST be backed by evidence. ` +
    skills
  )
}

// Streams a live model response and drives a bounded tool-result -> model
// continuation loop (M3c): the model may run skills and log findings; each
// skill/finding result is fed back so the model can react — e.g. attach
// evidence to a finding it just logged. Verification is computed here, never by
// the model. Emits text_delta / skill / finding events, then a single done. An
// abort finalizes with done; a stream error emits error and no done.
export async function runSend(
  req: AgentSendRequest,
  cfg: ProviderConfig,
  emit: (e: AgentEvent) => void,
  signal: AbortSignal,
  companyId?: string,
  engagementId?: string,
): Promise<void> {
  let model
  try { model = resolveModel(cfg) } catch (err) { emit({ type: 'error', message: (err as Error).message }); return }

  const firstUser = req.history.findIndex(m => m.role === 'user')
  const prior = firstUser === -1 ? [] : req.history.slice(firstUser)
  const messages: { role: 'user' | 'assistant'; content: string }[] = [...prior, { role: 'user', content: req.text }]

  const registry = createRunRegistry()
  const recordingEmit = (e: AgentEvent) => { registry.record(e); emit(e) }
  const drafts = new Map<string, Finding>()
  let lastFindingId: string | null = null

  const persistAndEmit = (f: Finding) => { upsertFinding(req.chatId, f); emit({ type: 'finding', ...f }) }

  const pack = skillsForEngagement(req.engagementType)

  try {
    for (let step = 0; step < STEP_CAP; step++) {
      let assistantText = ''
      const result = streamText({ model, system: systemPrompt(req.engagementType, req.phaseLabel, pack), messages, abortSignal: signal })
      for await (const delta of result.textStream) { assistantText += delta; emit({ type: 'text_delta', delta }) }

      const calls = parseSkillCalls(assistantText)
      if (calls.length === 0) break

      messages.push({ role: 'assistant', content: assistantText })
      const results: string[] = []
      let requestedInputs = false

      for (const c of calls) {
        if (c.name === 'request_inputs') {
          const items = parseInputItems(c.args)
          if (items.length) { emit({ type: 'input_request', requestId: randomUUID(), items }); requestedInputs = true }
          // A request_inputs that parses to zero items would otherwise emit no
          // card and give the model no feedback — the run silently hangs on
          // "Requesting inputs". Feed the format back so the model retries.
          else results.push('[request_inputs produced NO items — the items arg is missing or malformed. Use exactly items=KEY:LABEL:SENS:REQ;... e.g. items=M365_TENANT_ID:Tenant domain:-:r;M365_APP_ID:App registration client ID:-:r;M365_CERT:Certificate:s:r]')
          continue
        }
        if (c.name === 'log_finding') {
          const id = randomUUID()
          const ev = evidenceFromArgs(c.args, registry)
          const evidence = ev ? [ev] : []
          const finding: Finding = {
            id, title: c.args.title ?? 'Untitled finding', sev: normalizeSev(c.args.sev),
            phase: c.args.phase ?? req.phaseLabel ?? '', time: 'just now',
            rationale: c.args.rationale ?? '', evidence, verified: computeVerified(evidence),
          }
          drafts.set(id, finding); lastFindingId = id
          persistAndEmit(finding)
          results.push(finding.verified
            ? `[finding ${id} logged, VERIFIED]`
            : `[finding ${id} logged, UNVERIFIED — attach evidence: SKILL_CALL[attach_evidence|finding=${id}|tool_output=SKILL_ID] or |host=HOST|detail=ISSUE]`)
        } else if (c.name === 'attach_evidence') {
          const fid = c.args.finding ?? lastFindingId ?? ''
          const finding = drafts.get(fid)
          if (!finding) { results.push(`[attach_evidence: unknown finding ${fid}]`); continue }
          const ev = evidenceFromArgs(c.args, registry)
          if (!ev) { results.push(`[finding ${finding.id} still UNVERIFIED — evidence did not resolve]`); continue }
          finding.evidence = [...finding.evidence, ev]
          finding.verified = computeVerified(finding.evidence)
          persistAndEmit(finding)
          results.push(`[finding ${finding.id} now VERIFIED]`)
        } else if (companyId && engagementId) {
          const skillDef = c.name === 'probe'
            ? { name: 'probe', build: () => ({ command: process.execPath, args: ['-e', `process.stdout.write('probe-output')`] }) }
            : pack[c.name]
          if (!skillDef) { results.push(`[unknown skill ${c.name}]`); continue }
          const id = randomUUID()
          const inv: SkillInvocation = { skill: c.name, companyId, engagementId, account: c.args.account, region: c.args.region, tenant: c.args.tenant }
          const deps: RunDeps = { getScope, injectEnv, filledEnvVars }
          const outcome = await runSkill(inv, skillDef as any, recordingEmit, deps, id)
          // Report the ACTUAL outcome to the model — a failed/missing tool must
          // never be reported as a run, or the model claims a scan happened that
          // never did instead of telling the operator to install/fix it.
          if (outcome.state === 'success') {
            if (req.phaseLabel) setPhaseCoverage(engagementId, req.phaseLabel, 'in_progress')
            results.push(`[skill ${c.name} ran, id=${id} — reference its output with tool_output=${id}]`)
          } else if (outcome.state === 'unavailable') {
            const hint = (skillDef as SkillDef).installCmd
            results.push(`[skill ${c.name} could NOT run: ${outcome.reason}. Do NOT claim the scan ran — tell the operator to install it${hint ? ` (${hint})` : ''}, then retry.]`)
          } else if (outcome.state === 'error') {
            results.push(`[skill ${c.name} failed to run: ${outcome.reason}. Do not claim it ran.]`)
          } else if (outcome.state === 'denied') {
            results.push(`[skill ${c.name} was denied: ${outcome.reason} — the target is out of scope.]`)
          } else if (outcome.state === 'blocked') {
            // A required credential is missing; runSkill already emitted an
            // input_request. Pause the turn to await input, like request_inputs.
            requestedInputs = true
            results.push(`[skill ${c.name} is blocked awaiting operator input: ${outcome.reason}.]`)
          }
        } else {
          results.push(`[skill ${c.name} unavailable: no engagement context]`)
        }
      }
      if (requestedInputs) break   // await operator input; the card drives resume
      messages.push({ role: 'user', content: results.join('\n') })
    }
    emit({ type: 'done' })
  } catch (err) {
    if (signal.aborted || (err as Error)?.name === 'AbortError') { emit({ type: 'done' }); return }
    emit({ type: 'error', message: (err as Error).message })
  }
}
