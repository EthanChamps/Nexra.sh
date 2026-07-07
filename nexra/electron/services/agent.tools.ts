import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { AgentEvent } from './agent.types'
import type { EngagementScope } from './store.types'
import { validate, type Target } from './scope'
import { join } from 'node:path'

// A skill wrapper exits with this code to mean "a runtime prerequisite is
// missing" (e.g. the ScubaGear module isn't installed) — distinct from a clean
// success so runSkill reports `unavailable` with an install hint, not a green run.
export const UNAVAILABLE_EXIT_CODE = 3

// The typed-skill execution layer (M3b). The agent NEVER gets a freeform shell;
// it may only invoke one of these fixed skills. That is what makes both the
// scope guarantee and the "agent can't see the credential" guarantee real:
//   1. Scope is checked in-process before anything spawns (below the LLM).
//   2. Credentials are injected into the CHILD process env at spawn — the agent
//      only ever receives the child's stdout, never its environment.

export interface SkillDef {
  name: string
  // Env vars that must be FILLED (present in the injected env) before this runs.
  requiredEnvVars?: string[]
  // Shown to the operator when the tool binary isn't installed (spawn ENOENT).
  installCmd?: string
  // One-line description rendered into the system prompt's skill menu.
  promptLine?: string
  // Build the concrete child command from a validated invocation.
  build(inv: SkillInvocation): { command: string; args: string[] }
}

export interface SkillInvocation extends Target {
  skill: string
  companyId: string
  engagementId: string
}

// Injected so tests can supply fakes and main can wire the real vault/scope.
export interface RunDeps {
  getScope(engagementId: string): EngagementScope | undefined
  injectEnv(companyId: string): Record<string, string>
  filledEnvVars(companyId: string): string[]
  // Overridable for tests; defaults to node:child_process.spawn.
  spawn?: (command: string, args: string[], options: SpawnOptions) => import('node:child_process').ChildProcess
  // Base environment the child inherits before creds are overlaid. Defaults to
  // process.env with AWS_* stripped so nothing bleeds in from the host.
  baseEnv?: Record<string, string | undefined>
}

export type SkillResult =
  | { state: 'success'; exitCode: number }
  | { state: 'denied'; reason: string }
  | { state: 'blocked'; reason: string }
  // The tool binary isn't installed (spawn ENOENT). Distinct from `success` so
  // the model is told to have the operator install it, not that the scan ran.
  | { state: 'unavailable'; reason: string }
  // The child failed to spawn for some other reason (e.g. EACCES).
  | { state: 'error'; reason: string }

// Strip credential-shaped vars from an inherited environment so a stray host
// value can't leak into a skill run; the vault's injected values are overlaid
// on top by the caller.
export function cleanBaseEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (v == null) continue
    if (/^AWS_/.test(k)) continue
    if (/^M365_/.test(k)) continue
    out[k] = v
  }
  return out
}

// Run one typed skill. Emits `skill`/`secret_request`/`scope_request` events;
// resolves to a structured result. NEVER spawns on deny or block.
export function runSkill(
  inv: SkillInvocation,
  def: SkillDef,
  emit: (e: AgentEvent) => void,
  deps: RunDeps,
  id: string = randomUUID(),
): Promise<SkillResult> {
  // Gate 1 — scope must exist (populated by operator or via scope_request).
  const scope = deps.getScope(inv.engagementId)
  if (!scope) {
    emit({ type: 'scope_request', engagementId: inv.engagementId })
    emit({ type: 'skill', id, skill: def.name, state: 'blocked', message: 'no scope set for this engagement' })
    return Promise.resolve({ state: 'blocked', reason: 'no-scope' })
  }

  // Gate 2 — target must be in scope. Enforced below the LLM; never spawns.
  const decision = validate({ account: inv.account, region: inv.region, tenant: inv.tenant }, scope)
  if (!decision.allowed) {
    emit({ type: 'skill', id, skill: def.name, state: 'denied', message: decision.reason })
    return Promise.resolve({ state: 'denied', reason: decision.reason ?? 'out of scope' })
  }

  // Gate 3 — every required credential env var must be FILLED; else request the
  // missing ones and never spawn. Field-based (not fixed-name) so the operator
  // may name the secret anything (M3d).
  if (def.requiredEnvVars && def.requiredEnvVars.length) {
    const have = new Set(deps.filledEnvVars(inv.companyId))
    const missing = def.requiredEnvVars.filter(k => !have.has(k))
    if (missing.length) {
      emit({ type: 'input_request', requestId: id, items: missing.map(k => ({ key: k, label: k, sensitive: true, required: true })) })
      emit({ type: 'skill', id, skill: def.name, state: 'blocked', message: 'awaiting credential: ' + missing.join(', ') })
      return Promise.resolve({ state: 'blocked', reason: 'awaiting-secret' })
    }
  }

  // Spawn. Credentials go into the CHILD env only. `emit` carries child stdout
  // chunks — never the env — so the agent sees output, never the secret.
  const base = deps.baseEnv ? cleanBaseEnv(deps.baseEnv) : cleanBaseEnv(process.env)
  const env = { ...base, ...deps.injectEnv(inv.companyId) }
  const spawn = deps.spawn ?? nodeSpawn
  const { command, args } = def.build(inv)
  const startedAt = Date.now()

  emit({ type: 'skill', id, skill: def.name, state: 'running', command })

  return new Promise<SkillResult>(resolve => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    const onChunk = (buf: Buffer) => emit({ type: 'skill', id, skill: def.name, state: 'output', command, chunk: buf.toString('utf8') })
    child.stdout?.on('data', onChunk)
    child.stderr?.on('data', onChunk)
    child.on('error', err => {
      // A spawn failure is NOT a successful run. ENOENT means the tool binary
      // isn't installed — surface that as `unavailable` (with an install hint)
      // so the operator/model can act, not a green check over an empty box.
      const notInstalled = (err as NodeJS.ErrnoException).code === 'ENOENT'
      if (notInstalled) {
        const reason = `${command} is not installed`
        emit({ type: 'skill', id, skill: def.name, state: 'unavailable', command, message: reason, installCmd: def.installCmd })
        resolve({ state: 'unavailable', reason })
      } else {
        emit({ type: 'skill', id, skill: def.name, state: 'error', command, message: err.message })
        resolve({ state: 'error', reason: err.message })
      }
    })
    child.on('close', code => {
      const exitCode = code ?? 0
      if (exitCode === UNAVAILABLE_EXIT_CODE) {
        const reason = `${command} reported a missing prerequisite`
        emit({ type: 'skill', id, skill: def.name, state: 'unavailable', command, message: reason, installCmd: def.installCmd })
        resolve({ state: 'unavailable', reason })
        return
      }
      const duration = ((Date.now() - startedAt) / 1000).toFixed(1) + 's'
      emit({ type: 'skill', id, skill: def.name, state: 'success', command, exitCode, duration })
      resolve({ state: 'success', exitCode })
    })
  })
}

// ── AWS tool pack (M3b-2) ────────────────────────────────────────────────────
// Real wrappers for Prowler / ScoutSuite / PMapper. They read AWS creds from
// the env the vault injects (AWS_ACCESS_KEY_ID / _SECRET_ACCESS_KEY /
// _SESSION_TOKEN). Executing them for real needs the tools installed + an AWS
// account (the milestone "Done when"); the runSkill plumbing + guarantee above
// is exercised by tests with a fake skill.
export const AWS_SKILLS: Record<string, SkillDef> = {
  run_prowler: {
    name: 'run_prowler',
    requiredEnvVars: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
    installCmd: 'pip install prowler',
    promptLine: 'run_prowler|account=ID|region=REGION: Enumerate via Prowler.',
    build: inv => ({ command: 'prowler', args: ['aws', ...(inv.region ? ['-f', inv.region] : [])] }),
  },
  run_scoutsuite: {
    name: 'run_scoutsuite',
    requiredEnvVars: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
    installCmd: 'pip install scoutsuite',
    promptLine: 'run_scoutsuite|account=ID: Enumerate via ScoutSuite.',
    build: () => ({ command: 'scout', args: ['aws'] }),
  },
  run_pmapper: {
    name: 'run_pmapper',
    requiredEnvVars: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
    installCmd: 'pip install principalmapper',
    promptLine: 'run_pmapper|account=ID: Enumerate via PMapper.',
    build: () => ({ command: 'pmapper', args: ['graph', 'create'] }),
  },
}

// The vendored PowerShell wrapper that connects app-only and runs Invoke-SCuBA.
// Shipped alongside the services; resolved at runtime.
export const SCUBA_WRAPPER = join(__dirname, 'scripts', 'run-scubagear.ps1')

// ── M365 tool pack ───────────────────────────────────────────────────────────
// ScubaGear (CISA M365 Secure Configuration Baseline). App-only certificate auth;
// creds arrive via the injected child env (M365_TENANT_ID / M365_APP_ID /
// M365_CERT), never via args. See docs/superpowers/specs/2026-07-07-nexra-m365-vertical-design.md.
export const M365_SKILLS: Record<string, SkillDef> = {
  run_scubagear: {
    name: 'run_scubagear',
    requiredEnvVars: ['M365_TENANT_ID', 'M365_APP_ID', 'M365_CERT'],
    installCmd: 'pwsh -c "Install-Module ScubaGear -Scope CurrentUser"',
    promptLine: 'run_scubagear|tenant=TENANT: Assess the M365 tenant against the CISA SCuBA secure-configuration baseline via ScubaGear.',
    build: inv => ({ command: 'pwsh', args: ['-NoProfile', '-File', SCUBA_WRAPPER, '-Tenant', inv.tenant ?? ''] }),
  },
}

// Resolve the skill pack an engagement may use. Approach A: keyed by type so
// each vertical (AWS live; M365 here; Azure/pentest later) owns its own pack.
export function skillsForEngagement(type: string): Record<string, SkillDef> {
  switch (type) {
    case 'aws':  return AWS_SKILLS
    case 'm365': return M365_SKILLS
    default:     return {}
  }
}
