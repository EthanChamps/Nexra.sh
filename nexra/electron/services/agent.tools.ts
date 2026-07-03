import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { AgentEvent } from './agent.types'
import type { EngagementScope } from './store.types'
import { validate, type Target } from './scope'

// The typed-skill execution layer (M3b). The agent NEVER gets a freeform shell;
// it may only invoke one of these fixed skills. That is what makes both the
// scope guarantee and the "agent can't see the credential" guarantee real:
//   1. Scope is checked in-process before anything spawns (below the LLM).
//   2. Credentials are injected into the CHILD process env at spawn — the agent
//      only ever receives the child's stdout, never its environment.

export interface SkillDef {
  name: string
  // Credential reference this skill needs FILLED before it can run (or none).
  requiredSecret?: string
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
  hasFilledSecret(companyId: string, name: string): boolean
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

// Strip credential-shaped vars from an inherited environment so a stray host
// value can't leak into a skill run; the vault's injected values are overlaid
// on top by the caller.
export function cleanBaseEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (v == null) continue
    if (/^AWS_/.test(k)) continue
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
  const decision = validate({ account: inv.account, region: inv.region }, scope)
  if (!decision.allowed) {
    emit({ type: 'skill', id, skill: def.name, state: 'denied', message: decision.reason })
    return Promise.resolve({ state: 'denied', reason: decision.reason ?? 'out of scope' })
  }

  // Gate 3 — required credential must be FILLED; else request it, never spawn.
  if (def.requiredSecret && !deps.hasFilledSecret(inv.companyId, def.requiredSecret)) {
    emit({ type: 'secret_request', name: def.requiredSecret, fields: [] })
    emit({ type: 'skill', id, skill: def.name, state: 'blocked', message: 'awaiting credential: ' + def.requiredSecret })
    return Promise.resolve({ state: 'blocked', reason: 'awaiting-secret' })
  }

  // Spawn. Credentials go into the CHILD env only. `emit` carries child stdout
  // chunks — never the env — so the agent sees output, never the secret.
  const base = deps.baseEnv ? cleanBaseEnv(deps.baseEnv) : cleanBaseEnv(process.env)
  const env = { ...base, ...deps.injectEnv(inv.companyId) }
  const spawn = deps.spawn ?? nodeSpawn
  const { command, args } = def.build(inv)

  emit({ type: 'skill', id, skill: def.name, state: 'running' })

  return new Promise<SkillResult>(resolve => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    const onChunk = (buf: Buffer) => emit({ type: 'skill', id, skill: def.name, state: 'output', chunk: buf.toString('utf8') })
    child.stdout?.on('data', onChunk)
    child.stderr?.on('data', onChunk)
    child.on('error', err => {
      emit({ type: 'skill', id, skill: def.name, state: 'success', exitCode: -1, message: err.message })
      resolve({ state: 'success', exitCode: -1 })
    })
    child.on('close', code => {
      const exitCode = code ?? 0
      emit({ type: 'skill', id, skill: def.name, state: 'success', exitCode })
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
    requiredSecret: 'aws',
    build: inv => ({ command: 'prowler', args: ['aws', ...(inv.region ? ['-f', inv.region] : [])] }),
  },
  run_scoutsuite: {
    name: 'run_scoutsuite',
    requiredSecret: 'aws',
    build: () => ({ command: 'scout', args: ['aws'] }),
  },
  run_pmapper: {
    name: 'run_pmapper',
    requiredSecret: 'aws',
    build: () => ({ command: 'pmapper', args: ['graph', 'create'] }),
  },
}
