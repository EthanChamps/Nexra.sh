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
  // Tells the model EXACTLY which inputs this skill authenticates from, so it
  // requests those (and nothing else) via request_inputs instead of inventing a
  // generic login. Rendered into the prompt's Credentials block; pack-level, so
  // it is identical across every phase of an engagement.
  credentialHint?: string
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
const AWS_CRED_HINT = 'The AWS skills authenticate from AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (both secret; AWS_SESSION_TOKEN optional). When you need AWS credentials, request_inputs EXACTLY those; never ask for a profile name.'

export const AWS_SKILLS: Record<string, SkillDef> = {
  run_prowler: {
    name: 'run_prowler',
    requiredEnvVars: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
    installCmd: 'pip install prowler',
    promptLine: 'run_prowler|account=ID|region=REGION: Enumerate via Prowler.',
    credentialHint: AWS_CRED_HINT,
    build: inv => ({ command: 'prowler', args: ['aws', ...(inv.region ? ['-f', inv.region] : [])] }),
  },
  run_scoutsuite: {
    name: 'run_scoutsuite',
    requiredEnvVars: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
    installCmd: 'pip install scoutsuite',
    promptLine: 'run_scoutsuite|account=ID: Enumerate via ScoutSuite.',
    credentialHint: AWS_CRED_HINT,
    build: () => ({ command: 'scout', args: ['aws'] }),
  },
  run_pmapper: {
    name: 'run_pmapper',
    requiredEnvVars: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
    installCmd: 'pip install principalmapper',
    promptLine: 'run_pmapper|account=ID: Enumerate via PMapper.',
    credentialHint: AWS_CRED_HINT,
    build: () => ({ command: 'pmapper', args: ['graph', 'create'] }),
  },
}

// The vendored PowerShell wrapper that runs Invoke-SCuBA. Shipped alongside the
// services; resolved at runtime. Takes -Auth interactive|app to select the
// delegated sign-in (primary) or app-only certificate (fallback) path.
export const SCUBA_WRAPPER = join(__dirname, 'scripts', 'run-scubagear.ps1')

// ── M365 tool pack ───────────────────────────────────────────────────────────
// ScubaGear (CISA M365 Secure Configuration Baseline), two auth paths:
//   • run_scubagear (PRIMARY) — interactive DELEGATED sign-in with the account
//     the client provides for the engagement. No app registration and no
//     certificate: the operator completes one sign-in and ScubaGear drives the
//     per-product connections. This matches how M365 audits actually start —
//     the client hands over an account, not a service principal — so there is
//     nothing to pre-provision or gate on. The tenant is a scope target (the
//     tenant= arg, enforced by the scope gate), not a credential.
//   • run_scubagear_appauth (FALLBACK) — app-only certificate / service
//     principal auth for clients who require a scoped SP instead of a human
//     account, or fully-unattended runs. Creds arrive via the injected child
//     env (M365_TENANT_ID / M365_APP_ID / M365_CERT), never via args.
// See docs/superpowers/specs/2026-07-07-nexra-m365-vertical-design.md.

// Pack-level guidance. Steers the model to the delegated sign-in first and only
// to the certificate fallback when the client mandates a service principal;
// either way it never solicits a raw username/password.
const M365_CRED_HINT = 'M365 assessments authenticate DELEGATED by default: run_scubagear signs in interactively with the account the client provided for the engagement — the operator completes the sign-in themselves, so do NOT ask them to type a username or password into the console. The only value run_scubagear needs is the tenant/organization domain, which is its tenant= argument (a scope target, NOT a secret). Prefer run_scubagear. ONLY when the client requires a scoped service principal instead of a sign-in account, use run_scubagear_appauth and request its credentials with EXACTLY: SKILL_CALL[request_inputs|items=M365_TENANT_ID:Tenant domain:-:r;M365_APP_ID:App registration client ID:-:r;M365_CERT:Certificate (PFX path or thumbprint):s:r]. NEVER ask for a username or password directly.'

export const M365_SKILLS: Record<string, SkillDef> = {
  run_scubagear: {
    name: 'run_scubagear',
    // No pre-provided secret: delegated auth is completed by the operator at
    // sign-in time, so there is nothing to gate on. The tenant is enforced by
    // the scope gate via the tenant= arg, not treated as a credential.
    installCmd: 'pwsh -c "Install-Module ScubaGear -Scope CurrentUser"',
    promptLine: 'run_scubagear|tenant=TENANT: Assess the M365 tenant against the CISA SCuBA secure-configuration baseline via ScubaGear, signing in interactively with the client-provided account (no certificate or app registration). Preferred path.',
    credentialHint: M365_CRED_HINT,
    build: inv => ({ command: 'pwsh', args: ['-NoProfile', '-File', SCUBA_WRAPPER, '-Tenant', inv.tenant ?? '', '-Auth', 'interactive'] }),
  },
  run_scubagear_appauth: {
    name: 'run_scubagear_appauth',
    requiredEnvVars: ['M365_TENANT_ID', 'M365_APP_ID', 'M365_CERT'],
    installCmd: 'pwsh -c "Install-Module ScubaGear -Scope CurrentUser"',
    promptLine: 'run_scubagear_appauth|tenant=TENANT: Same ScubaGear assessment via app-only certificate (service principal) auth. Fallback for clients that require a scoped service principal instead of a sign-in account.',
    // No credentialHint: the shared M365_CRED_HINT on run_scubagear already
    // names this fallback and its exact inputs (credHints are de-duped in the
    // prompt), so a second copy would only add noise.
    build: inv => ({ command: 'pwsh', args: ['-NoProfile', '-File', SCUBA_WRAPPER, '-Tenant', inv.tenant ?? '', '-Auth', 'app'] }),
  },
}

// ── Web tool pack ────────────────────────────────────────────────────────────
// Every web skill runs in a pinned Docker container. Session auth reaches the
// tool via `docker run -e WEB_AUTH_HEADER` (env-var NAME only in argv); the
// VALUE is injected into the docker child's env by the vault and expanded to a
// header INSIDE the container by the shell — so it never appears in any emitted
// command/output event. The target URL is passed positionally (never string-
// interpolated), and is scope-validated below the LLM before this ever spawns.
export function dockerRun(opts: { image: string; script: string; positional: string[]; envPassthrough?: string[]; volumes?: string[] }): { command: string; args: string[] } {
  const env = (opts.envPassthrough ?? []).flatMap(v => ['-e', v])
  const vols = (opts.volumes ?? []).flatMap(v => ['-v', v])
  return { command: 'docker', args: ['run', '--rm', ...env, ...vols, '--entrypoint', 'sh', opts.image, '-c', opts.script, 'nexra', ...opts.positional] }
}

const WEB_AUTH_ENV = 'WEB_AUTH_HEADER'
const WEB_CRED_HINT = `Web assessments authenticate with STATIC session material the operator provides — a session cookie or Authorization header. When authenticated testing is needed, request_inputs EXACTLY: SKILL_CALL[request_inputs|items=${WEB_AUTH_ENV}:Session header e.g. "Authorization: Bearer <token>" or "Cookie: session=...":s:r]. Never ask for a username or password. Unauthenticated skills need no credential.`
// Header flag added only when the operator supplied one: ${VAR:+ -H "$VAR"}.
const authHeaderExpr = `\${${WEB_AUTH_ENV}:+ -H "\$${WEB_AUTH_ENV}"}`

export const WEB_SKILLS: Record<string, SkillDef> = {
  web_probe: {
    name: 'web_probe',
    installCmd: 'docker pull projectdiscovery/httpx:latest',
    promptLine: 'web_probe|url=URL: Probe the target (status, title, tech) with httpx. Phase: Map.',
    credentialHint: WEB_CRED_HINT,
    build: inv => dockerRun({ image: 'projectdiscovery/httpx:latest', envPassthrough: [WEB_AUTH_ENV],
      script: `httpx -u "$1" -json -silent -tech-detect -status-code -title${authHeaderExpr}`, positional: [inv.url ?? ''] }),
  },
  web_scan: {
    name: 'web_scan',
    installCmd: 'docker pull projectdiscovery/nuclei:latest',
    promptLine: 'web_scan|url=URL: Templated vulnerability scan with nuclei. Phase: Scan.',
    credentialHint: WEB_CRED_HINT,
    build: inv => dockerRun({ image: 'projectdiscovery/nuclei:latest', envPassthrough: [WEB_AUTH_ENV],
      script: `nuclei -u "$1" -jsonl -silent -rl 50 -timeout 10${authHeaderExpr}`, positional: [inv.url ?? ''] }),
  },
  web_crawl: {
    name: 'web_crawl',
    installCmd: 'docker pull projectdiscovery/katana:latest',
    promptLine: 'web_crawl|url=URL: Crawl the app for endpoints with katana. Phase: Discover.',
    credentialHint: WEB_CRED_HINT,
    build: inv => dockerRun({ image: 'projectdiscovery/katana:latest', envPassthrough: [WEB_AUTH_ENV],
      script: `katana -u "$1" -jsonl -silent -depth 3${authHeaderExpr}`, positional: [inv.url ?? ''] }),
  },
  web_content_discovery: {
    name: 'web_content_discovery',
    installCmd: 'docker pull ffuf/ffuf:latest',
    promptLine: 'web_content_discovery|url=URL: Content discovery with ffuf against the bundled wordlist. Phase: Discover.',
    credentialHint: WEB_CRED_HINT,
    build: inv => dockerRun({ image: 'ffuf/ffuf:latest', envPassthrough: [WEB_AUTH_ENV],
      volumes: [`${join(__dirname, 'assets', 'web-wordlist.txt')}:/wl.txt:ro`],
      script: `ffuf -w /wl.txt -u "$1/FUZZ" -of json -o /dev/stdout -s -rate 50${authHeaderExpr}`, positional: [inv.url ?? ''] }),
  },
  web_headers_tls: {
    name: 'web_headers_tls',
    installCmd: 'docker pull nexra/web-headers-tls:latest',
    promptLine: 'web_headers_tls|url=URL: Check security headers + TLS posture. Phase: Scan.',
    credentialHint: WEB_CRED_HINT,
    build: inv => dockerRun({ image: 'nexra/web-headers-tls:latest', envPassthrough: [WEB_AUTH_ENV],
      script: `check-headers-tls "$1"${authHeaderExpr}`, positional: [inv.url ?? ''] }),
  },
  web_sqli: {
    name: 'web_sqli',
    installCmd: 'docker pull ghcr.io/sqlmapproject/sqlmap:latest',
    promptLine: 'web_sqli|url=URL: Confirm SQL injection on a specific candidate URL with sqlmap. Phase: Verify (aggressive).',
    credentialHint: WEB_CRED_HINT,
    build: inv => dockerRun({ image: 'ghcr.io/sqlmapproject/sqlmap:latest', envPassthrough: [WEB_AUTH_ENV],
      script: `sqlmap -u "$1" --batch --level 2 --risk 1 --answers="quit=N" --disable-coloring${authHeaderExpr}`, positional: [inv.url ?? ''] }),
  },
}

// Resolve the skill pack an engagement may use. Approach A: keyed by type so
// each vertical (AWS live; M365 here; Azure/pentest later) owns its own pack.
export function skillsForEngagement(type: string): Record<string, SkillDef> {
  switch (type) {
    case 'aws':  return AWS_SKILLS
    case 'm365': return M365_SKILLS
    case 'web':  return WEB_SKILLS
    default:     return {}
  }
}
