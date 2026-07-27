# Nexra.sh — Web Application Pen-Test Vertical (Design)

**Date:** 2026-07-27
**Status:** Design — approved in brainstorming; pending user review before `writing-plans`.
**Author:** brainstormed with the operator (Salus Cyber).

## Goal

Add a **web application penetration-test** vertical to Nexra.sh that a
**small, local model can drive reliably**. The whole run happens on the
operator's own machine: a local model via **Ollama** (target: **Gemma 3,
12B–27B**) orchestrates opinionated, containerised web tools; the operator
reviews and authorises each methodology phase.

The design does not fight the locked architecture — it *finishes the pattern
that architecture already established*: push intelligence **below the LLM**
(typed skills, scope enforced in-process, credentials injected into the child,
`verified` computed in main). Every choice here also shrinks how much the model
must get right, because the model is deliberately weak.

### Design principle (applied throughout)

> Every decision moved out of the model's head and into a deterministic wrapper
> is a decision a small model cannot get wrong.

### Locked constraints (from prior decisions)

- **Target model:** Gemma 3 12B–27B via Ollama (OpenAI-compatible `/v1`).
- **Execution:** all tools run in **Docker containers** (`docker run --rm`),
  versions pinned by image tag. Same `docker` spawn on macOS and Windows — no
  WSL path translation.
- **Autonomy:** **checkpointed per phase.** The agent runs a phase
  autonomously within scope, then pauses for operator go/no-go before the next.
- **Auth:** **static session material** (session cookie / bearer or
  `Authorization` header / Basic creds). No login-form automation.
- **Model output:** **schema-constrained JSON** (Ollama structured output) for
  the web pack, with a cheap validate-and-repair fallback. Native tool-calls
  are rejected — Gemma's tool support in Ollama is absent/unreliable.

### Non-goals (explicit)

- Login-form / headless-browser authentication (session material only).
- Report export / PDF (that is the separate Phase 5 milestone; this vertical
  logs findings to the panel exactly like the AWS vertical).
- Changing the AWS or M365 verticals. Their `SKILL_CALL[...]` text grammar and
  packs are untouched — the web pack is additive.
- Multi-agent orchestration / attack-tree planning (deferred, per HANDOVER).
- DNS-rebinding trust, auto-following out-of-scope redirects.

### Implementation note (single spec, staged build)

The operator chose "full vertical in one spec." This is one design document; the
`writing-plans` step will **stage the implementation** so it lands
incrementally and stays reviewable — suggested order: (1) type + scope model +
enforcement, (2) Map+Scan walking skeleton (`web_probe`, `web_scan`) +
findings, (3) constrained-output layer + per-phase budgets + checkpoints, (4)
Discover + Verify skills + wordlist, (5) auth injection, (6) injection
hardening + tests. Each stage is a task with an implementer + reviewer loop.

---

## Architecture overview

```
operator ──> web engagement (type:'web')
                │  phases: Map → Discover → Scan → Verify → Report  (linear)
                ▼
        agent.live loop (per-phase step budget)
                │  action chosen via SCHEMA-CONSTRAINED JSON (Ollama)
                │  action.enum narrowed to CURRENT PHASE's allowed skills
                ▼
        runSkill()  ── Gate 1: scope exists
                    ── Gate 2: TARGET URL validated below the LLM  ◄── web scope
                    ── Gate 3: required auth creds filled
                    ▼
             docker run --rm <pinned image> <baked flags> <validated target>
                    │  creds injected as -e → passed as -H headers (never model-visible)
                    ▼
             stdout JSON ──> per-skill PARSER (main process)
                                │  summary  ──────────► fed back to model
                                │  candidate findings ► pre-drafted UNVERIFIED
                                │  raw JSON ──────────► stored evidence (tool_output)
                                ▼
                    phase budget spent OR model emits `checkpoint`
                                ▼
                    checkpoint card → break → operator Continue authorises next phase
```

No new execution primitive: `runSkill` already spawns a child and streams
stdout (`agent.tools.ts`); the child is now `docker`. No renderer component
imports a service directly — everything flows through `window.nexra.*`.

---

## Section 1 — Engagement type & phase methodology

### New `web` review type

- Add `'web'` to `ReviewTypeId` (`store.types.ts`).
- Add `WEB_SKILLS` and a `case 'web'` in `skillsForEngagement()`
  (`agent.tools.ts`). AWS/M365 unchanged.
- Add a `web` entry to `buildTypes()` (`seed.ts`): `linear: true`, the five
  phases below, and web scope display rows (Target URL(s), In-scope hosts,
  Exclusions, Auth).

### Phases (linear methodology / state machine)

| # | Phase | Purpose | Allowed skills |
|---|-------|---------|----------------|
| 1 | **Map** | Live surface + tech fingerprint | `web_probe` |
| 2 | **Discover** | Crawl + content discovery | `web_crawl`, `web_content_discovery` |
| 3 | **Scan** | Templated vuln scan + header/TLS | `web_scan`, `web_headers_tls` |
| 4 | **Verify** | Confirm candidates (aggressive/stateful) | `web_sqli` |
| 5 | **Report** | Findings review (no tool) | — |

Each phase declares the **menu of skills allowed in that phase**. The agent
loop injects only the current phase's allowed actions into the constrained
schema's `action` enum (Section 4), so the model picks from a short list and
literally cannot invoke a tool that is invalid now. This is a **guardrail**,
not single-stepping — a 12–27B model handles ordering within a phase; the
guardrail catches drift and keeps aggressive tools in their place.

### Checkpointed transitions

At each phase boundary the loop emits a **checkpoint card** and `break`s,
reusing the existing pause/resume primitive (the `requestedInputs` break in
`agent.live.ts` + the M3d Continue button). The operator reviews the phase's
findings, then clicks Continue to authorise the next phase.

Because `web_sqli` (and any active fuzzing) lives in **Verify**, it can never
fire before an explicit operator go — **safety by phase placement**, not by
trusting the model to be cautious.

---

## Section 2 — Web scope model & enforcement (the safety gate)

Ungated execution means the scope layer *is* what keeps tools off out-of-scope
hosts. This is the highest-risk surface and lands first.

### Enforced scope type (additive)

Extend `EngagementScope` (`store.types.ts`) — additive so old DB rows upgrade in
place (the M4 additive-schema rule):

```ts
hosts?:       string[]   // exact hostnames in scope, e.g. app.acme.com
wildcards?:   string[]   // "*.acme.com" — matched by label-boundary suffix
urlPrefixes?: string[]   // optional path scoping, e.g. https://app.acme.com/api/
exclusions?:  string[]   // hosts or URL prefixes that are NEVER in scope
```

`mode:'all'` is **not** offered for web (a web pentest is always an explicit
allowlist). An empty web allowlist fails closed, identical to the cloud rule.

### `Target` + `validate()` extension (`scope.ts`)

Add `url?: string` to `Target`. Web validation, enforced below the LLM:

1. **Parse** the candidate URL → scheme, host, port, path. Unparseable →
   **denied** (fail closed). Non-`http(s)` scheme → denied.
2. **Exclusions first, and they always win.** If host or normalized URL matches
   any `exclusions` entry → denied, regardless of the allowlist.
3. **Host allow.** Host must match `hosts` (exact, case-insensitive) or
   `wildcards` (suffix at a label boundary, so `*.acme.com` matches
   `app.acme.com` but not `notacme.com`). Else denied.
4. **Path allow.** If `urlPrefixes` is non-empty, the normalized URL must start
   with one. Else denied.
5. Empty allowlist (no hosts/wildcards/urlPrefixes) → denied.

### Normalization (anti-bypass)

Before matching: lowercase host, strip default ports (`:80`/`:443`), resolve
`.`/`..` path segments, collapse duplicate slashes, decode redundant
percent-encoding. The host is treated as the **literal** in scope — an IP target
must itself be listed (no DNS trust). Wrappers do **not** auto-follow redirects
that leave scope.

### Enforcement point

Every web skill resolves and validates its concrete target URL inside
`runSkill`'s scope gate (`agent.tools.ts`, Gate 2) **before any `docker run`
spawns**. The model proposes a URL; the gate re-derives, normalizes, and
validates it. The model's string is never trusted — identical to the
account/region guarantee today.

**Discovered URLs are re-validated.** Crawl/content-discovery *produce* new
URLs; any follow-on skill re-runs each through the scope gate before touching
it. Discovery output is untrusted data — a crawler wandering to an out-of-scope
link cannot escalate into a scan of it.

---

## Section 3 — Web skill pack (Docker wrappers) + auth

### Wrappers

Every skill's `build()` returns a `docker run --rm <pinned-image> <args>`
command; the child `runSkill` spawns is `docker`. `installCmd` becomes a
`docker pull …` hint, and Docker-not-installed surfaces through the existing
ENOENT → `unavailable` path (`agent.tools.ts`).

| Skill | Phase | Image (pinned by tag) | Emits |
|-------|-------|-----------------------|-------|
| `web_probe` | Map | `projectdiscovery/httpx` | live/status/title/tech JSON |
| `web_crawl` | Discover | `projectdiscovery/katana` | endpoint list (JSONL) |
| `web_content_discovery` | Discover | `ffuf/ffuf` + mounted wordlist | discovered paths (JSON) |
| `web_scan` | Scan | `projectdiscovery/nuclei` | findings (JSONL, severity built in) |
| `web_headers_tls` | Scan | small deterministic checker image | header/TLS gaps (JSON) |
| `web_sqli` | Verify | `sqlmap` image | injection verdict (structured) |

`build()` bakes in sane flags, **rate limits, and per-tool timeouts** (e.g.
`nuclei -jsonl -rl <cap> -timeout <n>`). The model supplies **only a
scope-validated target** — never flags. This is the opinionated-skill principle
that keeps a small model from needing tool syntax.

### Container networking, output, lifecycle

- Default container network so the tool reaches the target.
- Results come back on **stdout as JSON** (no volume) for every skill **except**
  `web_content_discovery`, which mounts a **read-only wordlist volume**.
- `--rm` guarantees no leftover containers; a per-skill **wall-clock timeout**
  kills a hung container (and the loop reports it as `error`, not `success`).

### Bundled wordlist

`web_content_discovery` ships a **vendored default wordlist** (a curated
SecLists subset) mounted read-only into the container, with an operator override
path. Vendoring keeps the run fully local and reproducible.

### Auth injection (static session material)

Extend the relevant `SkillDef`s with `requiredEnvVars` for the auth material and
inject it into the **container** exactly as creds reach a child today — the
agent never sees it:

- Stored via the existing `request_inputs` + vault flow (`secrets.vault.ts`) as
  `WEB_SESSION_COOKIE` / `WEB_AUTH_HEADER` / `WEB_BASIC_CREDS`.
- The wrapper passes them as **header args** into the container
  (`nuclei -H "$WEB_AUTH_HEADER"`, `ffuf -H …`), sourced from the injected
  env — never interpolated into the model-visible command string.
- **Command redaction:** the `skill` event's `command` field is **redacted**
  for web (headers carry the token). This is a small delta from the cloud path,
  where the command is safe to show. Redaction happens before the event is
  emitted to the renderer/model.

---

## Section 4 — Constrained-output layer & agent-loop changes

The small-model reliability core (approach A + cheap B fallback).

### Schema-constrained decoding (web + Ollama only)

When provider is Ollama **and** engagement is `web`, the loop drives the model
with a **JSON schema** for its next action instead of free text. Over the
OpenAI-compat `/v1` path (`providers.ts`) this is
`response_format: { type: 'json_schema', … }`; the send path gains a way to pass
it through (AI SDK structured-output / `experimental_output`). Schema:

```jsonc
{
  "action": "web_probe|web_crawl|web_content_discovery|web_scan|web_headers_tls|web_sqli|log_finding|attach_evidence|checkpoint|done",
  "target": "string (URL) — required for skill actions",
  "finding": { "title": "...", "sev": "...", "rationale": "...", "evidenceRef": "..." },
  "note": "string — short operator-facing narration"
}
```

`action`'s enum is **narrowed to the current phase's allowed skills** each step
(Section 1), so the decoder cannot select an out-of-phase tool.

### Separate parse path, old grammar intact

Add `parseStructuredAction()` beside `parseSkillCalls()` (`agent.live.ts`). The
loop uses the structured path for `web` + Ollama; the existing `SKILL_CALL[...]`
regex for every other engagement/provider (and as the fallback when structured
output is unavailable). **AWS/M365 behaviour is byte-for-byte unchanged.**

### Validate-and-repair (approach B, bounded)

JSON valid but semantically off (target fails the scope gate, references a
non-existent finding, etc.): feed a one-line correction back and re-prompt,
mirroring the existing empty-`request_inputs` repair (`agent.live.ts`). Bounded
per phase so a small model cannot thrash.

### Per-phase step budget (replaces `STEP_CAP`)

`STEP_CAP = 6` (`agent.live.ts`) is far too low for a multi-phase web run.
Replace the single constant with a **per-phase step budget**: the loop runs
within a phase up to its budget, then must emit a `checkpoint` and stop for
operator Continue. The run is bounded **by methodology**, not one global
number, and a runaway model still cannot loop forever — budget exhausted →
**forced checkpoint** (not a silent stop, and the operator sees why).

---

## Section 5 — Findings, evidence & prompt-injection handling

### Deterministic finding extraction (model does not parse dumps)

Each wrapper emits structured JSON; a **per-skill parser in the main process**
reduces it to:

1. a **compact model-facing summary** — e.g.
   `nuclei: 2 findings — [critical] exposed .git at /.git/HEAD; [medium] missing CSP on /login`; and
2. **candidate finding records** with **severity already mapped** (`nuclei`'s
   own severity → `Severity` via `normalizeSev`, `agent.findings.ts`).

`verified` stays computed in main (`agent.findings.ts`), never by the model.

### Pre-drafted findings — the model curates, it does not author

Because the parser already produces candidate findings, the loop **pre-drafts
them as UNVERIFIED** and hands the model the list to confirm / attach evidence,
rather than relying on Gemma to author each finding from scratch. A meaningful
small-model win. The operator still reviews at the phase checkpoint.

### Evidence

The raw structured JSON (matched-at URL, template ID, request/response excerpt)
is the stored evidence artifact via the existing `tool_output` registry
(`agent.findings.ts`), referenced by ID and capped at `EXCERPT_MAX`. The
typed-but-unwired `image` evidence kind (`store.types.ts`) can carry a
screenshot later; not in this spec.

### Prompt-injection containment (web output is attacker-controlled)

Page bodies, headers, and error strings are adversarial input. Defenses,
structural first:

1. **Never feed raw target output to the model** — only the parser's structured
   summary. Malicious HTML/JS in a response never reaches the model verbatim.
2. **Target-derived text can never change control state.** Scope, credentials,
   and which skill runs come only from operator input and the deterministic
   layer — never inferred from tool output. A discovered URL is still
   re-validated by the scope gate (Section 2), so a planted in-band link cannot
   widen scope.
3. A short standing line in the web system prompt that tool output is untrusted
   data, not instructions. Structural containment (1 & 2) is the real control.

---

## Section 6 — Testing strategy

Follows the repo's TDD + subagent-review process. All tests run under the
existing Vitest suite (`npm test`), no display or real network required.

### Unit

- **Scope `validate()` (web):** exclusions win; wildcard label-boundary
  matching (`*.acme.com` matches `app.acme.com`, rejects `notacme.com`);
  path-prefix enforcement; unparseable/non-http denied; empty allowlist fails
  closed; normalization anti-bypass cases (`APP.ACME.COM:443`, `/a/../b`,
  percent-encoding).
- **`build()` per skill:** produces the expected pinned `docker run` argv, bakes
  rate-limit/timeout flags, and never places auth material in the model-visible
  command (redaction).
- **Constrained-action parser:** valid schema JSON → action; the phase-scoped
  enum rejects out-of-phase actions; malformed → repair path.
- **Per-skill result parsers:** sample tool JSON → correct summary + candidate
  findings + severity mapping.
- **Per-phase budget:** exhaustion forces a `checkpoint`, not a silent stop.

### Integration (fakes, no real containers/network)

- `runSkill` with a **fake spawn** standing in for `docker`: scope-deny never
  spawns; missing auth cred emits `input_request` and never spawns;
  Docker-missing (ENOENT) → `unavailable` with pull hint; success → summary fed
  back + candidate findings pre-drafted.
- **Full phase walk (web):** Map → checkpoint → Discover → … driven by a
  scripted structured-output model, asserting checkpoints break the loop and
  Continue resumes.
- **Discovered-URL re-validation:** a crawl result containing an out-of-scope
  URL is denied by the follow-on skill.
- **Injection:** raw adversarial stdout never appears in the messages fed back
  to the model (only the structured summary does).

### Manual dogfood (Phase-6-style, one real run)

One authorised, in-scope target (a deliberately vulnerable app, e.g. a local
OWASP Juice Shop container): Gemma via Ollama runs Map→Verify, logs verified
findings with evidence, honours checkpoints, and never touches an excluded host.
Proof, not description.

---

## Files touched (anticipated)

- `store.types.ts` — `'web'` in `ReviewTypeId`; web fields on `EngagementScope`.
- `scope.ts` — `url?` on `Target`; web branch in `validate()`; normalization.
- `agent.tools.ts` — `WEB_SKILLS` pack (Docker `build()`s); `case 'web'`;
  command redaction for web; auth `requiredEnvVars`.
- `agent.live.ts` — `parseStructuredAction()`; per-phase step budget replacing
  `STEP_CAP`; summary-not-raw feedback; pre-draft candidate findings; checkpoint
  emission.
- `agent.findings.ts` — per-skill result parsers → summary + candidate findings.
- `providers.ts` / send path — pass `response_format` json_schema for
  web + Ollama.
- `seed.ts` — `web` entry in `buildTypes()` (phases + scope rows).
- `secrets.vault.ts` — no structural change; web auth uses the existing flow.
- Vendored wordlist asset + a small `web_headers_tls` checker image reference.
- Tests across `nexra/test/`.

## Risks & open questions

- **Ollama structured-output fidelity on Gemma 3.** `response_format` json_schema
  support over the compat `/v1` path should be verified against the operator's
  exact Ollama/Gemma build before relying on it; the repair fallback is the
  safety net, but if constrained decoding is weak the small-model reliability
  case degrades. *Verify early in the plan.*
- **Container network egress.** Default bridge networking reaches the target but
  also the internet; consider whether wrappers should constrain egress. Not
  gated in v1 — flagged.
- **Image supply chain.** Pinned public images are pulled locally; pin by digest
  (not just tag) if provenance matters to the engagement.
- **`web_sqli` output volume/sensitivity.** The wrapper must summarize to a
  verdict; raw dumps must not enter model context (Section 5 covers this, but it
  is the riskiest parser to get right).

## Done when

A `web` engagement can, on the operator's machine with Ollama + Gemma: run the
five-phase methodology against an in-scope target, pausing for operator Continue
at each phase; invoke the Docker-containerised pack with baked flags and
injected (model-invisible) session auth; enforce host/URL scope below the LLM
including on discovered URLs; and produce verified findings backed by structured
evidence — with AWS/M365 verticals unchanged and `npm test` green.
