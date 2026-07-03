// Skill names the agent can invoke, mirrored from the SKILL_CALL grammar
// documented in electron/services/agent.live.ts's systemPrompt(). Keep this
// map in sync if a new skill is added there.
const SKILL_LABELS: Record<string, string> = {
  request_inputs: 'Requesting inputs',
  run_prowler: 'Running Prowler scan',
  run_scoutsuite: 'Running ScoutSuite scan',
  run_pmapper: 'Running PMapper',
  probe: 'Running test probe',
  log_finding: 'Logging finding',
  attach_evidence: 'Attaching evidence',
}

// Matches a COMPLETE SKILL_CALL[...] occurrence — an in-progress bracket call
// still streaming in (no closing bracket yet) is deliberately left alone and
// briefly shows its raw form until the bracket arrives, rather than flickering
// a label on partial text. Also matches the bracketless colon form the model
// occasionally emits (SKILL_CALL:name|...), terminated by end of line — this is
// masked eagerly since it has no closing bracket to wait for. Kept in sync with
// parseSkillCalls() in electron/services/agent.live.ts.
const SKILL_CALL_RE = /SKILL_CALL(?:\[([a-z_]+)\|[^\]]*\]|:([a-z_]+)\|[^\n]*)/g

// Renders the model's control syntax as a short human label instead of the raw
// SKILL_CALL[...] grammar. Render-time only — never mutates stored message
// content, so parsing/persistence upstream is unaffected.
export function friendlySkillCalls(text: string): string {
  return text.replace(SKILL_CALL_RE, (_match, bracketName: string, colonName: string) => {
    const name = bracketName ?? colonName
    const label = SKILL_LABELS[name] ?? name.replace(/_/g, ' ')
    return `→ ${label}`
  })
}
