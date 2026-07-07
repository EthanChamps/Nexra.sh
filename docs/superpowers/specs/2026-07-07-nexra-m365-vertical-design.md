# Nexra M365 Config-Review Vertical — Design

**Date:** 2026-07-07
**Status:** Approved (design), pending implementation plan
**Author:** brainstormed with operator (Ethan)

## Goal

Make the **M365 Config Review** engagement type genuinely runnable end-to-end,
to the same bar the AWS vertical (M3b) reached: the embedded agent can enumerate
a client's Microsoft 365 tenant, log evidence-backed findings, and do so under
the same below-the-LLM safety guarantees (scope enforced in-process, credentials
never visible to the model, honest tool-state reporting).

Today "m365" exists only as presentation metadata (`seed.ts` — label, phases,
CIS M365 v4.0 benchmark, tenant scope rows). Every capability below the UI is
AWS-only: the sole skill registry is `AWS_SKILLS`, the system prompt hardcodes
the AWS skill list and AWS credential guidance regardless of engagement type,
the credential plumbing checks `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, and
the scope model (`Target`, `EngagementScope`, `validate`) understands only AWS
account + region. Running an M365 engagement today gives the agent nothing to
execute and no tenant to scope against.

## Decisions (locked)

1. **Collection tool: ScubaGear.** CISA's M365 Secure Configuration Baseline
   assessor — the 1:1 analog to Prowler. One invocation (`Invoke-SCuBA`) sweeps
   Entra / Exchange / SharePoint / Teams / Defender and emits a CIS/SCuBA-aligned
   report.
2. **Auth: service principal + certificate (app-only).** Fully non-interactive,
   fits the ungated automated model. The vault stores tenant ID, app (client) ID,
   and a certificate. No human in the loop per run.
3. **Execution platform: cross-platform via PowerShell 7.** M365 reviews must be
   runnable on both macOS and Windows. ScubaGear's current providers are
   Graph/PnP/ExchangeOnlineManagement-module based and run on PS7. App-only
   certificate auth on non-Windows is the flagged technical spike (see Risks).
4. **Architecture: skill-pack resolver keyed by engagement type** (Approach A).
   The single seam that generalizes to the other deferred verticals.

## Non-goals

- Azure / internal / external verticals (separate specs; pentest carries a higher
  safety bar and must not be first).
- Report export / PDF generation (Phase 5, separate).
- Interactive / device-code auth (rejected — breaks the ungated headless model).
- Rewriting the agent loop, evidence model, or findings persistence — all reused
  unchanged.

## Architecture: the five seams

The AWS vertical is the template. We change exactly five seams and nothing else;
the agent loop, evidence/verification computation, findings persistence, input-
request cards, and the `success`/`unavailable`/`blocked`/`denied`/`error` state
machine in `runSkill` are all reused verbatim.

### Seam 1 — Skill-pack resolver (Approach A)

Replace the hardcoded `AWS_SKILLS` reference in `agent.live.ts` with a resolver:

```ts
// agent.tools.ts
export function skillsForEngagement(type: ReviewTypeId): Record<string, SkillDef> {
  switch (type) {
    case 'aws':  return AWS_SKILLS
    case 'm365': return M365_SKILLS
    default:     return {}   // azure/internal/external not yet implemented
  }
}
```

`runSend` resolves the pack once from `req.engagementType` and uses it both for
skill dispatch (replacing `AWS_SKILLS[c.name]` at `agent.live.ts:145`) and for
building the system prompt. An engagement type with no pack yields `{}` — the
existing "unknown skill" path already handles a skill name that isn't in the
pack, so an unimplemented type degrades honestly rather than mis-dispatching.

### Seam 2 — `M365_SKILLS` tool pack (`agent.tools.ts`)

One primary skill, structured exactly like the AWS `SkillDef`s:

```ts
export const M365_SKILLS: Record<string, SkillDef> = {
  run_scubagear: {
    name: 'run_scubagear',
    requiredEnvVars: ['M365_TENANT_ID', 'M365_APP_ID', 'M365_CERT'],
    installCmd: 'pwsh -c "Install-Module ScubaGear -Scope CurrentUser"',
    build: inv => ({
      command: 'pwsh',
      args: ['-NoProfile', '-File', SCUBA_WRAPPER, '-Tenant', inv.tenant ?? ''],
    }),
  },
}
```

`SCUBA_WRAPPER` is a small vendored PowerShell script (shipped in the app
resources, path resolved at runtime) that:

1. Reads tenant / app / certificate from the injected **child env** (never args
   that could log a secret).
2. Verifies the ScubaGear module is importable; if not, exits with a **distinct
   non-zero code** so the skill reports `unavailable` with the install hint
   rather than a false green (see Seam 3).
3. Connects app-only with the certificate and runs `Invoke-SCuBA` for the product
   set mapped from the engagement phase (Identity→aad, Exchange→exo,
   SharePoint→sharepoint, Compliance→defender; full-sweep when no phase).
4. Reads the ScubaGear results JSON and prints a concise machine-readable
   pass/fail summary **plus the results path** to stdout. This is what the agent
   sees and references via `tool_output=SKILL_ID` — the existing evidence path
   works unchanged; no new evidence type is introduced.

### Seam 3 — Requirement preflight

`pwsh` may be installed while the ScubaGear module is not, so a bare spawn ENOENT
check is insufficient. Two-level detection:

- **`pwsh` itself missing** → `runSkill` already maps spawn ENOENT to
  `unavailable` with `installCmd`. No change.
- **module missing / not importable** → the wrapper exits with a sentinel code
  and prints an install instruction to stderr. `runSkill` currently treats any
  clean close as `success`; we extend it minimally to recognize the sentinel exit
  code as `unavailable` (carrying the wrapper's message + `installCmd`). This is
  the only change to the shared `runSkill`, and it is additive — AWS skills never
  emit the sentinel, so their behavior is unchanged.

### Seam 4 — Tenant scope (`store.types.ts`, `scope.ts`)

Extend the enforced scope model with a tenant dimension:

```ts
export interface EngagementScope {
  mode: 'all' | 'allowlist'
  accounts: string[]
  regions: string[]
  tenants: string[]   // NEW — M365/Azure tenant allowlist
}

export interface Target { account?: string; region?: string; tenant?: string }  // + tenant
```

`validate()` gains a tenant check with the same **fail-closed** semantics as
accounts/regions: under `mode:'allowlist'`, a non-empty `tenants` list requires
`target.tenant` to be present and included; an allowlist that is empty across all
dimensions still fails closed. `mode:'all'` still permits anything the injected
credential can reach. The tenant is validated **below the LLM** exactly like the
AWS account, preserving the scope guarantee for M365.

**Migration:** existing `EngagementScope` rows (sqlite) predate `tenants`. The
scope read path defaults a missing `tenants` to `[]` so old AWS rows load
unchanged; covered by a schema/migration test.

### Seam 5 — Prompt + credential routing

- **`systemPrompt(engagementType, phaseLabel, pack)`** renders the resolved
  pack's skill descriptions instead of the hardcoded AWS list, and swaps the
  AWS-specific credential paragraph ("run_* skills authenticate from
  AWS_ACCESS_KEY_ID…") for pack-appropriate guidance. For M365: request
  `M365_TENANT_ID` (not-secret), `M365_APP_ID` (not-secret), `M365_CERT`
  (secret); do not ask for values ScubaGear derives from these.
- **`cleanBaseEnv`** (`agent.tools.ts`) strips `M365_*` (and any certificate
  material) in addition to `AWS_*`, so a stray host value can't bleed into a
  child run. The vault overlays the engagement's named secrets on top, as today.

## Data flow (M365 run)

1. Operator opens an M365 engagement chat → `req.engagementType === 'm365'`.
2. `runSend` resolves `pack = skillsForEngagement('m365')` → `M365_SKILLS`; builds
   the system prompt from that pack.
3. Agent emits `SKILL_CALL[run_scubagear|tenant=contoso.onmicrosoft.com]` (or the
   phase-scoped variant).
4. `runSkill` gates: scope exists → tenant in scope → `M365_TENANT_ID/APP_ID/CERT`
   all filled. Any gate unmet → `scope_request` / `denied` / `input_request`, no
   spawn.
5. All gates pass → spawn `pwsh` with creds injected into the **child env only**;
   the wrapper connects app-only, runs `Invoke-SCuBA`, prints summary + results
   path to stdout.
6. Agent reads the summary, logs findings with `tool_output=<skill id>` evidence;
   `computeVerified` marks them verified. Findings persist via `upsertFinding`.

## Testing & done-criteria

Mirror the AWS test suite (`agent.tools.test.ts`, `scope.test.ts`,
`m3b-integration.test.ts`) with M365 equivalents, all using a **fake spawn** so no
live tenant is needed for CI:

- **Scope deny:** a `run_scubagear` against a tenant not in the allowlist returns
  `denied`, never spawns.
- **Missing-credential block:** absent `M365_CERT` → `input_request` for the
  missing var(s), `blocked`, never spawns.
- **Unavailable (pwsh missing):** spawn ENOENT → `unavailable` + install hint.
- **Unavailable (module missing):** wrapper sentinel exit → `unavailable` + hint,
  **not** `success`.
- **Success:** fake spawn emits a summary → `success`, output referenceable as
  `tool_output`.
- **Prompt/pack routing:** an `m365` engagement is offered M365 skills and **not**
  AWS skills; an `aws` engagement is unchanged.
- **Scope migration:** an old `EngagementScope` row without `tenants` loads as
  `tenants: []`.
- **Integration:** m365 engagement → skill call → finding logged & verified.

**Ship-ready is met when:**

1. All of the above pass on **macOS and Windows** (`npm test` green on both).
2. A real ScubaGear run against a live **E5 tenant** (app-only cert auth) produces
   at least one evidence-backed, verified finding — on both OSes, or the macOS
   spike (below) is formally descoped with the cross-platform decision revisited.
3. The scope-setting UI accepts and persists a **tenant** for an M365 engagement.
4. The M365 seed phases map to ScubaGear product groups (verified in the wrapper's
   phase→product mapping).

## Risks

- **App-only certificate auth on PS7 / non-Windows (primary spike).** ScubaGear's
  historically common path is `-CertificateThumbprint` against the Windows cert
  store. Cross-platform app-only auth needs the certificate delivered as an
  injected PFX (path + password, or base64 in env) and the modules connected with
  an explicit certificate object before `Invoke-SCuBA`. First implementation task
  should be a spike proving a live cross-platform app-only connection; if a
  ScubaGear provider has no Mac path, fall back to the "Windows-run, gate cleanly
  on macOS" posture and revisit decision 3 with the operator. The `M365_CERT`
  env-var name is intentionally abstract to accommodate either thumbprint or PFX.
- **ScubaGear runtime & module install weight.** Large module set; the `unavailable`
  + `installCmd` path must be genuinely actionable, and CI must never depend on a
  live tenant (fake spawn only).
- **Secret handling for the certificate.** A PFX/password is more sensitive than
  an access key; ensure it is only ever in the child env and stripped from the
  base env (`cleanBaseEnv`), never in skill args or logged output.

## Out of scope for this vertical (explicit)

Report export, Azure/pentest verticals, multi-agent orchestration, interactive
auth. Follows the AWS vertical's process: spec → writing-plans → subagent-driven
implementation with reviewer per task → whole-branch review → finish-branch.
</content>
</invoke>
