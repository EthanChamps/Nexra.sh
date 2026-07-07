# M365 Config-Review Vertical Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the M365 Config Review engagement type runnable end-to-end — the agent enumerates a client tenant with ScubaGear and logs evidence-backed findings under the same below-the-LLM safety guarantees as the AWS vertical.

**Architecture:** Mirror the AWS vertical (M3b). Add a `tenant` dimension to the enforced scope, an `M365_SKILLS` tool pack fronting ScubaGear via a vendored PowerShell wrapper, a skill-pack resolver keyed by engagement type, and pack-aware prompt/credential routing. The agent loop, evidence model, findings persistence, and the `runSkill` state machine are reused unchanged except one additive sentinel-exit case.

**Tech Stack:** TypeScript, Electron, Vitest, node:child_process spawn, PowerShell 7 (`pwsh`) + ScubaGear module.

## Global Constraints

- No renderer component may import a service directly — go through `window.nexra.*`.
- Credentials go into the CHILD process env only; never into skill args, agent-facing events, or logs.
- Scope is validated in-process BELOW the LLM; a tool never spawns on deny/block.
- `tenants` on `EngagementScope` is OPTIONAL (`tenants?: string[]`); a missing value means `[]` (old rows load unchanged). Do not make it required — 15 existing scope literals omit it.
- Match the existing test style: fake `spawn` for all skill tests; CI must never touch a live tenant.
- ScubaGear execution target is cross-platform via PowerShell 7. App-only certificate auth on non-Windows is a spike (Task 7); the credential env var is named abstractly (`M365_CERT`) to accommodate thumbprint or PFX.
- Styling source of truth for any UI: `nexra/design-reference/Nexra.dc.html` — match hex/px exactly.

---

### Task 1: Tenant dimension in the enforced scope

**Files:**
- Modify: `nexra/electron/services/store.types.ts:57-61` (EngagementScope, Target lives in scope.ts)
- Modify: `nexra/electron/services/scope.ts:16` (Target), `scope.ts:23-40` (validate)
- Modify: `nexra/electron/services/store.sqlite.ts:40-45,183-194` (schema + persistence)
- Test: `nexra/test/scope.test.ts`, `nexra/test/store.sqlite.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `EngagementScope.tenants?: string[]`; `Target.tenant?: string`; `validate(target, scope)` now gates tenant; `getScopeRow`/`setScopeRow` persist `tenants`.

- [ ] **Step 1: Write the failing validate tests**

Add to `nexra/test/scope.test.ts` inside the `scope.validate` describe:

```ts
it('allowlist permits an in-scope tenant', () => {
  const s: EngagementScope = { mode: 'allowlist', accounts: [], regions: [], tenants: ['contoso.onmicrosoft.com'] }
  expect(validate({ tenant: 'contoso.onmicrosoft.com' }, s).allowed).toBe(true)
})

it('allowlist denies an out-of-scope tenant', () => {
  const s: EngagementScope = { mode: 'allowlist', accounts: [], regions: [], tenants: ['contoso.onmicrosoft.com'] }
  const d = validate({ tenant: 'evil.onmicrosoft.com' }, s)
  expect(d.allowed).toBe(false)
  expect(d.reason).toMatch(/out of scope/i)
})

it('allowlist requires the tenant it restricts', () => {
  const s: EngagementScope = { mode: 'allowlist', accounts: [], regions: [], tenants: ['contoso.onmicrosoft.com'] }
  expect(validate({}, s).allowed).toBe(false)
})

it('an allowlist with only tenants still fails closed when target has none', () => {
  const s: EngagementScope = { mode: 'allowlist', accounts: [], regions: [], tenants: [] }
  expect(validate({ tenant: 'contoso.onmicrosoft.com' }, s).allowed).toBe(false)
})
```

Add a persistence test to `nexra/test/scope.test.ts` inside `scope persistence`:

```ts
it('round-trips tenants and defaults a legacy row without them to []', () => {
  setScope('m365eng', { mode: 'allowlist', accounts: [], regions: [], tenants: ['contoso.onmicrosoft.com'] })
  expect(getScope('m365eng')).toEqual({ mode: 'allowlist', accounts: [], regions: [], tenants: ['contoso.onmicrosoft.com'] })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd nexra && npx vitest run test/scope.test.ts`
Expected: FAIL — new tenant assertions fail (validate ignores tenant; getScope returns no `tenants`).

- [ ] **Step 3: Add the type fields**

In `nexra/electron/services/store.types.ts`, extend `EngagementScope`:

```ts
export interface EngagementScope {
  mode: 'all' | 'allowlist'
  accounts: string[]
  regions: string[]
  tenants?: string[]   // M365/Azure tenant allowlist; undefined ⇒ [] (legacy rows)
}
```

In `nexra/electron/services/scope.ts`, extend `Target`:

```ts
export interface Target { account?: string; region?: string; tenant?: string }
```

- [ ] **Step 4: Gate the tenant in validate**

In `nexra/electron/services/scope.ts`, update `validate`. Replace the empty-allowlist guard and add the tenant block so all three dimensions are considered:

```ts
export function validate(target: Target, scope: EngagementScope): Decision {
  if (scope.mode === 'all') return { allowed: true }

  const tenants = scope.tenants ?? []
  if (scope.accounts.length === 0 && scope.regions.length === 0 && tenants.length === 0)
    return { allowed: false, reason: 'scope allowlist is empty — nothing is in scope' }

  if (scope.accounts.length > 0) {
    if (!target.account) return { allowed: false, reason: 'target account required by allowlist' }
    if (!scope.accounts.includes(target.account))
      return { allowed: false, reason: `account ${target.account} is out of scope` }
  }
  if (scope.regions.length > 0) {
    if (!target.region) return { allowed: false, reason: 'target region required by allowlist' }
    if (!scope.regions.includes(target.region))
      return { allowed: false, reason: `region ${target.region} is out of scope` }
  }
  if (tenants.length > 0) {
    if (!target.tenant) return { allowed: false, reason: 'target tenant required by allowlist' }
    if (!tenants.includes(target.tenant))
      return { allowed: false, reason: `tenant ${target.tenant} is out of scope` }
  }
  return { allowed: true }
}
```

- [ ] **Step 5: Persist tenants (additive column)**

In `nexra/electron/services/store.sqlite.ts`, the `scope` table (lines 40-45) stores JSON. Add a `tenants` column with a default so existing DBs migrate. After the `CREATE TABLE IF NOT EXISTS scope (...)` block, add an idempotent column add:

```ts
  db.exec(`CREATE TABLE IF NOT EXISTS scope (
    engagement_id TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    accounts TEXT NOT NULL,
    regions TEXT NOT NULL
  )`)
  // Additive migration: legacy scope rows predate tenants.
  const scopeCols = (db.prepare(`PRAGMA table_info(scope)`).all() as { name: string }[]).map(c => c.name)
  if (!scopeCols.includes('tenants')) db.exec(`ALTER TABLE scope ADD COLUMN tenants TEXT NOT NULL DEFAULT '[]'`)
```

Update `setScopeRow`:

```ts
export function setScopeRow(engagementId: string, s: EngagementScope): void {
  requireDb().prepare(
    `INSERT INTO scope (engagement_id, mode, accounts, regions, tenants) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(engagement_id) DO UPDATE SET mode=excluded.mode, accounts=excluded.accounts, regions=excluded.regions, tenants=excluded.tenants`,
  ).run(engagementId, s.mode, JSON.stringify(s.accounts), JSON.stringify(s.regions), JSON.stringify(s.tenants ?? []))
}
```

Update `getScopeRow`:

```ts
export function getScopeRow(engagementId: string): EngagementScope | undefined {
  const r = requireDb().prepare('SELECT mode, accounts, regions, tenants FROM scope WHERE engagement_id = ?').get(engagementId) as { mode: string; accounts: string; regions: string; tenants: string | null } | undefined
  if (!r) return undefined
  return { mode: r.mode as EngagementScope['mode'], accounts: JSON.parse(r.accounts), regions: JSON.parse(r.regions), tenants: r.tenants ? JSON.parse(r.tenants) : [] }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd nexra && npx vitest run test/scope.test.ts test/store.sqlite.test.ts`
Expected: PASS. If a pre-existing sqlite round-trip asserts scope equality, it now sees `tenants: []` — update that expectation to include `tenants: []`.

- [ ] **Step 7: Commit**

```bash
git add nexra/electron/services/store.types.ts nexra/electron/services/scope.ts nexra/electron/services/store.sqlite.ts nexra/test/scope.test.ts nexra/test/store.sqlite.test.ts
git commit -m "feat(scope): add enforced tenant dimension for M365"
```

---

### Task 2: M365 tool pack + skill-pack resolver + credential stripping

**Files:**
- Modify: `nexra/electron/services/agent.tools.ts` (add `M365_SKILLS`, `skillsForEngagement`, `UNAVAILABLE_EXIT_CODE`, extend `cleanBaseEnv`, add `tenant` to `SkillInvocation` via `Target`)
- Test: `nexra/test/agent.tools.test.ts`

**Interfaces:**
- Consumes: `SkillDef`, `SkillInvocation` (now carries `tenant?` via `Target`), `cleanBaseEnv`.
- Produces: `export const M365_SKILLS: Record<string, SkillDef>` with a `run_scubagear` def; `export function skillsForEngagement(type: string): Record<string, SkillDef>`; `export const UNAVAILABLE_EXIT_CODE = 3`. `run_scubagear.requiredEnvVars = ['M365_TENANT_ID','M365_APP_ID','M365_CERT']`.

- [ ] **Step 1: Write the failing tests**

Add to `nexra/test/agent.tools.test.ts`:

```ts
import { M365_SKILLS, skillsForEngagement, UNAVAILABLE_EXIT_CODE, AWS_SKILLS } from '../electron/services/agent.tools'

describe('M365 tool pack + resolver', () => {
  it('resolves the M365 pack for m365 engagements and AWS for aws', () => {
    expect(skillsForEngagement('m365')).toBe(M365_SKILLS)
    expect(skillsForEngagement('aws')).toBe(AWS_SKILLS)
    expect(skillsForEngagement('internal')).toEqual({})
  })

  it('run_scubagear requires tenant/app/cert credentials', () => {
    expect(M365_SKILLS.run_scubagear.requiredEnvVars).toEqual(['M365_TENANT_ID', 'M365_APP_ID', 'M365_CERT'])
  })

  it('run_scubagear builds a pwsh invocation carrying the tenant', () => {
    const built = M365_SKILLS.run_scubagear.build({ skill: 'run_scubagear', companyId: 'c1', engagementId: 'e1', tenant: 'contoso.onmicrosoft.com' })
    expect(built.command).toBe('pwsh')
    expect(built.args).toContain('contoso.onmicrosoft.com')
  })

  it('cleanBaseEnv strips M365_* as well as AWS_*', () => {
    const cleaned = cleanBaseEnv({ PATH: '/usr/bin', AWS_SECRET_ACCESS_KEY: 'x', M365_CERT: 'y', M365_APP_ID: 'z', KEEP: 'ok' })
    expect(cleaned).toEqual({ PATH: '/usr/bin', KEEP: 'ok' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd nexra && npx vitest run test/agent.tools.test.ts`
Expected: FAIL — `M365_SKILLS`, `skillsForEngagement`, `UNAVAILABLE_EXIT_CODE` not exported; `cleanBaseEnv` keeps `M365_*`.

- [ ] **Step 3: Extend cleanBaseEnv**

In `nexra/electron/services/agent.tools.ts`, update the strip predicate:

```ts
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
```

- [ ] **Step 4: Add the sentinel constant, M365 pack, and resolver**

Add near the top of `nexra/electron/services/agent.tools.ts` (after imports):

```ts
// A skill wrapper exits with this code to mean "a runtime prerequisite is
// missing" (e.g. the ScubaGear module isn't installed) — distinct from a clean
// success so runSkill reports `unavailable` with an install hint, not a green run.
export const UNAVAILABLE_EXIT_CODE = 3
```

Add after `AWS_SKILLS` (end of file). The wrapper path resolves relative to this module; it is created in Task 3:

```ts
import { join } from 'node:path'

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
```

Note: `SkillInvocation extends Target`, and Task 1 added `tenant?` to `Target`, so `inv.tenant` typechecks with no further change.

- [ ] **Step 5: Run to verify pass**

Run: `cd nexra && npx vitest run test/agent.tools.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add nexra/electron/services/agent.tools.ts nexra/test/agent.tools.test.ts
git commit -m "feat(agent): add M365 ScubaGear pack, skill-pack resolver, M365_ env stripping"
```

---

### Task 3: ScubaGear PowerShell wrapper + sentinel-exit → unavailable

**Files:**
- Create: `nexra/electron/services/scripts/run-scubagear.ps1`
- Modify: `nexra/electron/services/agent.tools.ts` (`runSkill` `child.on('close')`)
- Modify: build config so the `.ps1` ships next to compiled services (`nexra/package.json` and/or `nexra/electron-builder.yml`)
- Test: `nexra/test/agent.tools.test.ts`

**Interfaces:**
- Consumes: `UNAVAILABLE_EXIT_CODE` (Task 2).
- Produces: `runSkill` resolves `{ state: 'unavailable' }` when a child closes with `UNAVAILABLE_EXIT_CODE`; the wrapper script exists and prints a machine-readable summary on success.

- [ ] **Step 1: Write the failing test**

Add to `nexra/test/agent.tools.test.ts`. It uses a fake node child that exits with the sentinel code, proving runSkill maps it to `unavailable` (not `success`):

```ts
describe('runSkill — sentinel exit means unavailable', () => {
  it('maps UNAVAILABLE_EXIT_CODE close to unavailable, not success', async () => {
    const { events, emit } = collect()
    const sentinelSkill: SkillDef = {
      name: 'run_scubagear',
      installCmd: 'pwsh -c "Install-Module ScubaGear"',
      build: () => ({ command: process.execPath, args: ['-e', `process.exit(${UNAVAILABLE_EXIT_CODE})`] }),
    }
    const result = await runSkill(
      { skill: 'run_scubagear', companyId: 'c1', engagementId: 'e1', tenant: 't' },
      sentinelSkill, emit,
      { getScope: () => ({ mode: 'all', accounts: [], regions: [], tenants: [] }), injectEnv: () => ({}), filledEnvVars: () => [], baseEnv: { PATH: process.env.PATH } },
    )
    expect(result.state).toBe('unavailable')
    expect(events.some(e => e.type === 'skill' && e.state === 'unavailable')).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd nexra && npx vitest run test/agent.tools.test.ts -t "sentinel exit"`
Expected: FAIL — `result.state` is `'success'` (close currently always resolves success).

- [ ] **Step 3: Handle the sentinel exit in runSkill**

In `nexra/electron/services/agent.tools.ts`, replace the `child.on('close', ...)` handler:

```ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `cd nexra && npx vitest run test/agent.tools.test.ts`
Expected: PASS (all tools tests, including Task 2's).

- [ ] **Step 5: Create the wrapper script**

Create `nexra/electron/services/scripts/run-scubagear.ps1`. It reads creds from the env, verifies the module, connects app-only, runs the baseline, and prints a summary + results path. The connection block is refined by the Task 7 spike; this is the working skeleton:

```powershell
param([string]$Tenant)
$ErrorActionPreference = 'Stop'

# Prerequisite check — exit 3 (UNAVAILABLE_EXIT_CODE) so the app reports
# 'unavailable' with an install hint rather than a false-green success.
if (-not (Get-Module -ListAvailable -Name ScubaGear)) {
  [Console]::Error.WriteLine('ScubaGear module not installed. Install-Module ScubaGear -Scope CurrentUser')
  exit 3
}

$tenantId = $env:M365_TENANT_ID
$appId    = $env:M365_APP_ID
$cert     = $env:M365_CERT   # thumbprint (Windows store) or PFX path — resolved by the Task 7 spike

Import-Module ScubaGear
$out = Join-Path ([System.IO.Path]::GetTempPath()) ("scuba-" + [System.Guid]::NewGuid().ToString('N'))

# App-only certificate auth. On Windows a thumbprint against the cert store works;
# cross-platform uses a PFX-backed certificate object (Task 7). Invoke-SCuBA drives
# the connection from these parameters.
Invoke-SCuBA -ProductNames '*' -OrganizationName $Tenant -AppID $appId `
  -CertificateThumbprint $cert -OutPath $out -Quiet | Out-Null

$results = Get-ChildItem -Path $out -Recurse -Filter 'ScubaResults*.json' | Select-Object -First 1
if ($results) {
  $data = Get-Content $results.FullName -Raw | ConvertFrom-Json
  Write-Output "SCUBA_RESULTS_PATH=$($results.FullName)"
  Write-Output ($data.Summary | ConvertTo-Json -Depth 6 -Compress)
} else {
  Write-Output "SCUBA_RESULTS_PATH=(none produced)"
}
```

- [ ] **Step 6: Ship the script with the build**

The `.ps1` must sit at `<compiled services>/scripts/run-scubagear.ps1` so `SCUBA_WRAPPER` resolves at runtime. Verify how `electron/services` compiles (tsc `outDir`) and add a copy step. In `nexra/package.json`, extend the build script to copy the scripts dir after tsc, e.g.:

```json
"build:main": "tsc -p tsconfig.node.json && node -e \"require('node:fs').cpSync('electron/services/scripts', require('node:path').join(require('./package.json').main ? 'dist-electron/services/scripts' : 'dist/electron/services/scripts', ''), {recursive:true})\""
```

Confirm the real `outDir` first (read `tsconfig.node.json`), then set the copy destination to that compiled `services/scripts` path. In `nexra/electron-builder.yml`, ensure `**/scripts/*.ps1` is included in `files` (it is by default unless excluded). Verify by building:

Run: `cd nexra && npm run build`
Expected: build succeeds; `run-scubagear.ps1` present under the compiled services `scripts/` dir (check with `ls`).

- [ ] **Step 7: Commit**

```bash
git add nexra/electron/services/scripts/run-scubagear.ps1 nexra/electron/services/agent.tools.ts nexra/test/agent.tools.test.ts nexra/package.json nexra/electron-builder.yml
git commit -m "feat(agent): ScubaGear wrapper + sentinel-exit unavailable handling"
```

---

### Task 4: Pack-aware prompt + skill dispatch in the agent loop

**Files:**
- Modify: `nexra/electron/services/agent.live.ts:53-69` (systemPrompt), `agent.live.ts:100-145` (resolve pack; dispatch)
- Test: `nexra/test/agent.live.test.ts` (or a new `agent.live.m365.test.ts`)

**Interfaces:**
- Consumes: `skillsForEngagement` (Task 2), `M365_SKILLS`.
- Produces: `systemPrompt(engagementType, phaseLabel, pack)` renders the resolved pack's skills; `runSend` dispatches skills via `pack[c.name]` instead of `AWS_SKILLS[c.name]`.

- [ ] **Step 1: Write the failing test**

The system prompt is not directly exported. Test the observable behavior: an m365 engagement offers `run_scubagear` and does NOT mention `run_prowler`. Extract `systemPrompt` as an exported function to test it directly. Add to a new file `nexra/test/agent.live.m365.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { systemPrompt } from '../electron/services/agent.live'
import { skillsForEngagement } from '../electron/services/agent.tools'

describe('systemPrompt is pack-aware', () => {
  it('an m365 engagement is offered ScubaGear and not AWS tools', () => {
    const p = systemPrompt('m365', 'Identity', skillsForEngagement('m365'))
    expect(p).toContain('run_scubagear')
    expect(p).not.toContain('run_prowler')
    expect(p).toContain('m365')
  })

  it('an aws engagement still lists Prowler', () => {
    const p = systemPrompt('aws', 'IAM', skillsForEngagement('aws'))
    expect(p).toContain('run_prowler')
    expect(p).not.toContain('run_scubagear')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd nexra && npx vitest run test/agent.live.m365.test.ts`
Expected: FAIL — `systemPrompt` not exported / wrong arity.

- [ ] **Step 3: Make systemPrompt pack-aware**

In `nexra/electron/services/agent.live.ts`, export `systemPrompt` and build the skill list from the pack. Replace the function (lines 53-69). Each `SkillDef` needs a one-line description for the prompt; add an optional `promptLine?: string` to `SkillDef` in `agent.tools.ts` and set it on each skill, falling back to the skill name:

In `agent.tools.ts`, add to the `SkillDef` interface:

```ts
  // One-line description rendered into the system prompt's skill menu.
  promptLine?: string
```

Set `promptLine` on the AWS skills and `run_scubagear`, moving the existing descriptions out of the hardcoded prompt string. Example for scubagear:

```ts
    promptLine: 'run_scubagear|tenant=TENANT: Assess the M365 tenant against the CIS/SCuBA baseline via ScubaGear.',
```

And for the AWS ones, e.g. `run_prowler`: `promptLine: 'run_prowler|account=ID|region=REGION: Enumerate via Prowler.'` (copy the current text from the existing prompt verbatim).

Now rewrite `systemPrompt`:

```ts
export function systemPrompt(engagementType: string, phaseLabel: string, pack: Record<string, SkillDef>): string {
  const phase = phaseLabel ? ` Its current phase is: ${phaseLabel}.` : ''
  const packLines = Object.values(pack).filter(s => s.promptLine).map(s => `- ${s.promptLine}`).join('\n')
  const findingLines = [
    '- log_finding|title=TEXT|sev=Critical|High|Medium|Low|phase=TEXT|rationale=TEXT: Log a finding. Attach evidence in the SAME call with tool_output=SKILL_ID or host=HOST|detail=ISSUE.',
    '- attach_evidence|finding=FINDING_ID|tool_output=SKILL_ID  OR  |host=HOST|detail=ISSUE: Attach evidence. A finding is UNVERIFIED until evidence is attached.',
    '- request_inputs|items=KEY:LABEL:SENS:REQ;...: Ask the operator for credentials/config. SENS \'s\'=secret (default), \'-\'=not secret; REQ \'r\'=required (default), \'-\'=optional. Mark non-credentials (tenant, account id, region) as not-secret. Do NOT request values a skill derives from the credentials it already requires.',
  ].join('\n')
  const skills = `\nAvailable skills — invoke by writing SKILL_CALL[name|arg=value|...]:\n${packLines}\n${findingLines}`
  return (
    `You are Nexra, an AI assistant embedded in a security consultant's console, ` +
    `helping with a ${engagementType} engagement.${phase} ` +
    `Be precise and practical. Every finding you log MUST be backed by evidence. ` +
    skills
  )
}
```

Import `SkillDef` into `agent.live.ts` if not already: `import { runSkill, skillsForEngagement, type SkillDef, ... } from './agent.tools'`.

- [ ] **Step 4: Resolve the pack and dispatch through it**

In `runSend` (`agent.live.ts`), resolve the pack once before the step loop:

```ts
  const pack = skillsForEngagement(req.engagementType)
```

Update the `streamText` call to pass the pack:

```ts
      const result = streamText({ model, system: systemPrompt(req.engagementType, req.phaseLabel, pack), messages, abortSignal: signal })
```

Replace the dispatch line (currently `: AWS_SKILLS[c.name]` at ~line 145):

```ts
          const skillDef = c.name === 'probe'
            ? { name: 'probe', build: () => ({ command: process.execPath, args: ['-e', `process.stdout.write('probe-output')`] }) }
            : pack[c.name]
```

The `SkillInvocation` built at ~line 148 must carry the tenant so scope + the wrapper receive it:

```ts
          const inv: SkillInvocation = { skill: c.name, companyId, engagementId, account: c.args.account, region: c.args.region, tenant: c.args.tenant }
```

Remove the now-unused `AWS_SKILLS` import if nothing else references it (keep `skillsForEngagement`).

- [ ] **Step 5: Run the tests to verify pass**

Run: `cd nexra && npx vitest run test/agent.live.m365.test.ts test/agent.live.test.ts test/agent.live.m3b.test.ts`
Expected: PASS. Existing agent.live tests that referenced the old 2-arg `systemPrompt` (if any) get the pack arg; update those call sites.

- [ ] **Step 6: Commit**

```bash
git add nexra/electron/services/agent.live.ts nexra/electron/services/agent.tools.ts nexra/test/agent.live.m365.test.ts
git commit -m "feat(agent): pack-aware system prompt and skill dispatch by engagement type"
```

---

### Task 5: End-to-end M365 integration test

**Files:**
- Create: `nexra/test/m365-integration.test.ts` (model on `nexra/test/m3b-integration.test.ts`)

**Interfaces:**
- Consumes: `runSend`, `M365_SKILLS`, tenant scope, fake spawn + fake model — everything from Tasks 1-4.
- Produces: proof that an m365 engagement runs `run_scubagear` under tenant scope and logs a verified finding.

- [ ] **Step 1: Write the integration test**

Read `nexra/test/m3b-integration.test.ts` first to reuse its fake-model + fake-spawn harness verbatim. Create `nexra/test/m365-integration.test.ts` mirroring it, changed to: engagementType `'m365'`; scope `{ mode:'allowlist', accounts:[], regions:[], tenants:['contoso.onmicrosoft.com'] }`; filled env `['M365_TENANT_ID','M365_APP_ID','M365_CERT']`; the fake model emits `SKILL_CALL[run_scubagear|tenant=contoso.onmicrosoft.com]` then, on the tool-result turn, `SKILL_CALL[log_finding|title=Legacy auth enabled|sev=High|tool_output=<id>]`. Core assertions:

```ts
it('m365 engagement runs ScubaGear in-scope and logs a verified finding', async () => {
  const events: AgentEvent[] = []
  await runSend(m365Req, cfg, e => events.push(e), new AbortController().signal, 'c1', 'e1')

  const skill = events.find(e => e.type === 'skill' && (e as any).skill === 'run_scubagear')
  expect(skill).toBeTruthy()
  expect(events.some(e => e.type === 'skill' && (e as any).state === 'denied')).toBe(false)

  const finding = events.find(e => e.type === 'finding') as any
  expect(finding).toBeTruthy()
  expect(finding.verified).toBe(true)
})

it('denies ScubaGear against an out-of-scope tenant, never spawning', async () => {
  const events: AgentEvent[] = []
  // fake model calls run_scubagear|tenant=evil.onmicrosoft.com
  await runSend(outOfScopeReq, cfg, e => events.push(e), new AbortController().signal, 'c1', 'e1')
  expect(events.some(e => e.type === 'skill' && (e as any).state === 'denied')).toBe(true)
  expect(events.some(e => e.type === 'skill' && (e as any).state === 'success')).toBe(false)
})
```

Provide the full fake-model/spawn wiring by copying m3b-integration's helpers (do not import private helpers — repeat them in this file).

- [ ] **Step 2: Run to verify it passes**

Run: `cd nexra && npx vitest run test/m365-integration.test.ts`
Expected: PASS.

- [ ] **Step 3: Run the whole suite**

Run: `cd nexra && npm test`
Expected: PASS (no regressions).

- [ ] **Step 4: Commit**

```bash
git add nexra/test/m365-integration.test.ts
git commit -m "test(agent): end-to-end M365 ScubaGear + tenant-scope integration"
```

---

### Task 6: Scope-setting UI accepts a tenant

**Files:**
- Modify: the renderer scope editor component and its IPC path (locate via grep below)
- Test: the matching `*.test.tsx`

**Interfaces:**
- Consumes: `window.nexra` scope set/get exposing `tenants`.
- Produces: an operator can enter and persist a tenant for an M365 engagement; it flows to `setScope`.

- [ ] **Step 1: Locate the scope editor and IPC surface**

Run: `cd nexra && grep -rln "setScope\|enforcement\|EngagementScope\|allowlist" src electron/preload.ts electron/main.ts`
Read the component that renders the scope allowlist (accounts/regions inputs) and the preload/main IPC that carries `EngagementScope`. Confirm `tenants` is already carried structurally (it is part of the type, so the IPC passes it through) — the work is the UI field.

- [ ] **Step 2: Write the failing UI test**

In the scope editor's `*.test.tsx`, add a test that renders the editor for an m365 engagement, types a tenant, saves, and asserts the persisted scope includes `tenants: ['contoso.onmicrosoft.com']` (mock `window.nexra` scope-set and assert the argument). Model it on the existing accounts/regions assertions in that file.

- [ ] **Step 3: Run to verify failure**

Run: `cd nexra && npx vitest run <that test file>`
Expected: FAIL — no tenant input rendered.

- [ ] **Step 4: Add the tenant input**

Add a "Tenant(s)" input alongside accounts/regions in the scope editor, wired to the `tenants` array the same way regions are wired, matching `nexra/design-reference/Nexra.dc.html` hex/px. Show it for engagement types whose pack uses tenants (m365, and later azure); reuse the existing multi-value input pattern from regions rather than inventing a new control.

- [ ] **Step 5: Run to verify pass**

Run: `cd nexra && npx vitest run <that test file>`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add nexra/src nexra/test
git commit -m "feat(ui): tenant field in engagement scope editor"
```

---

### Task 7: Live cross-platform ScubaGear validation (ship gate)

**Files:**
- Modify: `nexra/electron/services/scripts/run-scubagear.ps1` (finalize app-only connection per spike findings)
- Create: `docs/superpowers/notes/2026-07-07-scubagear-crossplatform-spike.md` (record findings)

**Interfaces:**
- Consumes: everything above.
- Produces: a documented, verified live run; the wrapper's connection block finalized for both OSes (or a formal descope of macOS with decision 3 revisited).

This task is manual and gated on a live E5 tenant + an app registration with a certificate. It cannot run in CI.

- [ ] **Step 1: Provision test auth**

Register an app in the test tenant, grant ScubaGear's required read-only Graph/Exchange/SharePoint/Teams/Defender permissions (admin consent), and create a certificate credential. Record app ID + tenant.

- [ ] **Step 2: Spike app-only auth on PowerShell 7 (macOS)**

In `pwsh` on macOS, prove an app-only certificate connection using a PFX-backed certificate object (thumbprint-against-store is Windows-only). Determine the exact `M365_CERT` shape (PFX path + separate password var, or base64) that ScubaGear's providers accept. If any provider has no macOS path, note it.

- [ ] **Step 3: Finalize the wrapper connection block**

Update `run-scubagear.ps1`'s auth so it works on both OSes per the spike: on Windows use the thumbprint path; on non-Windows load the PFX into an `X509Certificate2` and connect. If a PFX password is needed, add `M365_CERT_PASSWORD` to `requiredEnvVars` in `M365_SKILLS` and to the prompt guidance (secret).

- [ ] **Step 4: Run a real assessment on each OS**

On macOS and Windows, run an M365 engagement in the app against the test tenant. Confirm: the skill reaches `success`, the summary + results path appear in the agent output, and the agent logs at least one evidence-backed VERIFIED finding.

- [ ] **Step 5: Record findings and decide**

Write the spike note with what worked, the final `M365_CERT` shape, and any macOS-unsupported providers. If macOS cannot run the full baseline, formally descope it (update the design's decision 3) and adopt the "Windows-run, gate cleanly on macOS via `unavailable`" posture — the sentinel/unavailable plumbing from Task 3 already supports that.

- [ ] **Step 6: Commit**

```bash
git add nexra/electron/services/scripts/run-scubagear.ps1 nexra/electron/services/agent.tools.ts docs/superpowers/notes/2026-07-07-scubagear-crossplatform-spike.md
git commit -m "feat(m365): finalize cross-platform ScubaGear app-only auth (validated on live tenant)"
```

---

## Self-Review

**Spec coverage:**
- Seam 1 (skill-pack resolver) → Task 2 (`skillsForEngagement`) + Task 4 (dispatch/prompt use it). ✓
- Seam 2 (`M365_SKILLS` + wrapper + summary stdout) → Task 2 (pack) + Task 3 (wrapper). ✓
- Seam 3 (requirement preflight / sentinel unavailable) → Task 3. ✓
- Seam 4 (tenant scope) → Task 1. ✓
- Seam 5 (prompt + credential routing / `cleanBaseEnv`) → Task 2 (env strip) + Task 4 (prompt). ✓
- Testing matrix (scope deny, missing-cred block, unavailable×2, success, routing, migration, integration) → Tasks 1-5. Missing-credential block is already covered by the existing `runSkill` required-env gate exercised through Task 5's harness. ✓
- Ship criteria (cross-platform pass, live E5 finding, tenant UI, phase→product mapping) → Task 6 (UI) + Task 7 (live/cross-platform + mapping finalized in wrapper). ✓

**Placeholder scan:** No TBD/TODO. Task 6/7 reference grep-located files rather than fixed paths because the renderer scope editor and live-auth specifics must be discovered/spiked — each still has concrete steps and commands. Acceptable: they are genuinely environment-dependent, not deferred design.

**Type consistency:** `EngagementScope.tenants?`, `Target.tenant?`, `SkillInvocation` (extends Target) `.tenant`, `skillsForEngagement(type: string)`, `systemPrompt(type, phase, pack)`, `SkillDef.promptLine?`, `UNAVAILABLE_EXIT_CODE = 3`, `SCUBA_WRAPPER` — used consistently across Tasks 1-5.
</content>
