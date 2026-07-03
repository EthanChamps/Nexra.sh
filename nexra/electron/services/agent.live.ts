import { streamText } from 'ai'
import { randomUUID } from 'node:crypto'
import type { AgentEvent, AgentSendRequest } from './agent.types'
import type { Finding, InputRequestItem } from './store.types'
import { resolveModel, type ProviderConfig } from './providers'
import { runSkill, AWS_SKILLS, type RunDeps, type SkillInvocation, type SkillDef } from './agent.tools'
import { getProjectScope } from './scope'
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

function systemPrompt(engagementType: string, phaseLabel: string): string {
  const phase = phaseLabel ? ` Its current phase is: ${phaseLabel}.` : ''
  const skills = `
Available skills — invoke by writing SKILL_CALL[name|arg=value|...]:
- run_prowler|account=ID|region=REGION: Enumerate via Prowler.
- run_scoutsuite|account=ID: Enumerate via ScoutSuite.
- run_pmapper|account=ID: Enumerate via PMapper.
- log_finding|title=TEXT|sev=Critical|High|Medium|Low|phase=TEXT|rationale=TEXT: Log a finding. Attach evidence in the SAME call with tool_output=SKILL_ID (a prior skill run) or host=HOST|detail=ISSUE.
- attach_evidence|finding=FINDING_ID|tool_output=SKILL_ID  OR  |host=HOST|detail=ISSUE: Attach evidence to a finding you logged. A finding is UNVERIFIED until evidence is attached; always verify your findings.
- request_inputs|items=KEY:LABEL:SENS:REQ;...: Ask the operator to supply credentials/config. Each item is env-var KEY, a short LABEL, SENS ('s' secret/masked, default; '-' not secret), and REQ ('r' required, default; '-' optional). Use this instead of listing needed inputs in prose. The run pauses until every required item is filled. Mark anything that is NOT a credential — a region, account id, profile name, or resource name — as not-secret with SENS '-'; reserve 's' for actual secrets (keys, tokens, passwords). Do NOT request values a skill already derives from the AWS credentials you request: the run_* skills authenticate from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, so never ask for an AWS/Prowler profile name.`
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

  try {
    for (let step = 0; step < STEP_CAP; step++) {
      let assistantText = ''
      const result = streamText({ model, system: systemPrompt(req.engagementType, req.phaseLabel), messages, abortSignal: signal })
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
            : AWS_SKILLS[c.name]
          if (!skillDef) { results.push(`[unknown skill ${c.name}]`); continue }
          const id = randomUUID()
          const inv: SkillInvocation = { skill: c.name, companyId, engagementId, account: c.args.account, region: c.args.region }
          const deps: RunDeps = { getScope: getProjectScope, injectEnv, filledEnvVars }
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
            // Two causes: a required credential is missing (runSkill already
            // emitted an input_request) or the target is out of scope but
            // proposable (runSkill already emitted a scope_proposal). Either
            // way, pause the turn to await input, like request_inputs.
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
