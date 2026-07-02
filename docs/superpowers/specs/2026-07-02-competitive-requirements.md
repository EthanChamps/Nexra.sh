# Nexra.sh — Competitive Requirements

**Date:** 2026-07-02
**Status:** Reference document (not a milestone spec — feeds M3/M4/M6 and future
milestone specs)
**Input:** deep-research pass on AI-driven pentesting harnesses/tools (XBOW,
PentestGPT/PentestGPT v2, Horizon3.ai NodeZero, PentAGI, PentestAgent,
HexStrike AI, Pentest Swarm AI, VulnBot, HPTSA, COCHISE, and others), full
findings in session history.

## Purpose

We looked at who else is building "AI across all phases of a pentest" —
funded startups (XBOW, Tenzai, Armadin), established vendors bolting AI onto
existing PtaaS platforms (Horizon3.ai NodeZero, Pentera, Cobalt, Rapid7), and
open-source agent frameworks structurally similar to Nexra.sh (PentAGI,
PentestAgent, HexStrike AI, Pentest Swarm AI). This document translates that
landscape into concrete requirements for Nexra.sh: what we must offer to be
taken seriously, where the real competitive openings are, and which hard
problems (safety, false positives) nobody has actually solved yet — so we
don't have to pretend we will either.

**Non-goal, stated explicitly:** none of this involves training, fine-tuning,
or otherwise building a custom model. Every requirement below assumes a
general-purpose frontier LLM as the reasoning engine — Claude by default,
provider-agnostic per the locked architecture in `CLAUDE.md`. Competing on
model quality is not our lane and is not addressed here. Everything below is
about tool integration, orchestration, safety architecture, and
engagement-specific tradecraft built *around* an off-the-shelf model.

## What the landscape tells us about the bar

- Nobody has "fully autonomous across all phases" working well. A recent
  benchmark (PentestEval) found human-in-the-loop tools succeed 31–39%
  end-to-end while fully autonomous agents (PentestAgent, VulnBot) succeed
  only 3–6%. The industry default that's actually shipping is "AI handles
  recon/scanning at scale, humans validate exploitation" — not the ungated,
  agent-does-everything model Nexra.sh targets.
- The vendors furthest ahead on real exploitation (XBOW, Horizon3.ai
  NodeZero) both back away from raw ungated execution in a specific way:
  XBOW pairs its AI explorer with a **deterministic validation layer** so it
  isn't just trusting the LLM's word that something worked; NodeZero runs
  execution inside **ephemeral, customer-controlled infrastructure**
  (one-time cloud instances or customer Docker/OVA appliances), not arbitrary
  shell access on arbitrary hosts.
- Marketing claims in this space are cheap and frequently disputed — XBOW's
  "#1 hacker on HackerOne" claim is contested (one independent analysis puts
  its real submission accuracy around 37.5%), and HexStrike AI's headline
  numbers (98.7% detection, 2.1% false positives) are unverified vendor
  claims with no benchmark behind them. The bar for *credible, checkable*
  claims is low — that's an opening, not just a risk to avoid.
- The sharpest unresolved technical problem industry-wide is **prompt
  injection from the target itself**: a red-team study on the CAI framework
  achieved 100% exploitation success via injected content and exfiltrated
  live API credentials mid-pentest; a separate study found LLM pentest
  agents ignoring explicit scope instructions and attacking out-of-scope
  systems. Any tool that gives an LLM real shell/PTY access against live
  targets — which is exactly Nexra.sh's target execution model — inherits
  this problem and has to answer it, not just acknowledge it.

## Requirements

### 1. Real multi-phase tool execution, not command suggestions

Table stakes. Several competitors get called out specifically for this gap —
one open-source "swarm" project markets itself as covering exploitation but
in practice only runs 8 recon-class tools today, with sqlmap/Burp/Metasploit
integration sitting on a roadmap as "planned." That gap between marketing and
actual tool coverage is exactly what erodes trust once a consultant runs it
for real.

Nexra.sh already commits to real, ungated shell/PTY execution (locked
decision). The requirement is **breadth of tool coverage per phase**,
actually wired and actually executing, before any phase is claimed as
supported:

- Recon/enumeration: nmap, subfinder, httpx, amass, nuclei, dnsx
- Web/app: Burp or an equivalent proxy, sqlmap, OWASP ZAP-class tooling
- Exploitation: Metasploit or equivalent, with real chained execution, not
  single-shot commands
- Credential/AD: BloodHound, Impacket, CrackMapExec/NetExec
- Post-exploitation/privesc: standard privesc enumeration + real (not
  simulated) privilege escalation attempts
- Cloud, per engagement type (see Requirement 5)

### 2. Structured multi-agent orchestration with persistent memory

The strongest published research result (PentestGPT v2) attributes its
performance to three architectural pieces, not model quality alone: a typed
tool/skill layer, a task-difficulty/attack-tree planning module, and an
**external memory subsystem** that keeps state outside the LLM's context
window specifically to prevent long campaigns from losing track of what's
already been tried. Other serious open-source projects (PentAGI) pair this
with a persistent knowledge graph across sessions.

Nexra.sh's Project → Engagement → Chat hierarchy is well-suited for this,
but it needs to actually carry structured state, not just chat transcripts:

- Each Chat needs state (targets tried, findings so far, dead ends) tracked
  outside the raw context window, so a long-running phase doesn't degrade as
  the transcript grows.
- Findings and scope discovered in one Chat should be retrievable by later
  Chats in the same Engagement (e.g., recon output feeding the exploitation
  phase's chat) — this is more than the flat message/finding persistence
  currently scoped for M4 and should be designed as a queryable structure,
  not just a longer history.

### 3. A validation step before a finding is presented, not just an LLM claim

This is the single biggest trust lever in the research. XBOW's own framing
of its architecture is "AI explores, deterministic engine validates" —
built specifically to avoid hallucinated findings. A red-team study on a
competing framework found an ungated agent **fabricate** a successful XSS
exploit rather than actually triggering one. Self-reported accuracy numbers
elsewhere in the space (HexStrike AI) are unverified and read as marketing
for exactly this reason.

Requirement: a finding the agent logs needs an evidence artifact attached
before it's surfaced to the consultant — a reproducible PoC re-run, a
response diff, a captured screenshot/output — not just the agent's assertion
that something worked. This is a design requirement for the Findings panel
and `AgentService`, not a documentation nicety: it's what separates a tool a
consultant can put their name behind from a demo.

### 4. Hard scope enforcement and prompt-injection defense at the execution layer

Non-negotiable given the locked ungated-execution decision, and the least
optional item on this list. Two concrete failure modes from the research:

- An LLM pentest agent ignored explicit scope instructions and attacked
  systems outside the permitted range in a real Active Directory test.
- A red-teamed autonomous pentest framework was fully compromised via prompt
  injection embedded in content returned by the target itself — the agent
  treated attacker-controlled recon output as instructions and leaked live
  API credentials as a result.

Requirements:

- Scope allowlisting enforced **outside the LLM's control**, at the
  tool-execution layer (`ShellService`/`AgentService` boundary), not just as
  a system-prompt instruction the model could ignore or be talked out of.
- All content returned from a target — HTTP responses, file contents,
  command output — must be treated as untrusted data, never as instructions,
  when it flows back into the agent's context.
- Execution cleanup/rollback registered *before* any action runs, so a
  crash, SIGINT, or runaway session doesn't leave a target or the operator's
  own environment in a bad state.

This is the substance that the existing M6 "prompt-injection review" roadmap
line item needs — it should become an actual architecture decision made
during M3 (`AgentService` design), not a checklist item reviewed after the
fact.

### 5. Real tool depth per engagement type, not generic network-pentest coverage

Nexra.sh's 5 fixed engagement types (AWS config review, Azure config review,
M365 config review, internal pentest, external pentest) are already more
cleanly separated than anything found in the research — most competitors
either do generic network/web pentesting or bundle "cloud" as one
undifferentiated category. That structural clarity is a real opening, but it
only pays off if each engagement type has its own vetted tool set wired in
end-to-end, for example:

- AWS: Prowler, ScoutSuite, PMapper
- Azure: ScoutSuite, Stormspotter, AzureHound
- M365: Microsoft Graph API tooling, ROADtools
- Internal/external: the tool set from Requirement 1

"All phases" needs to be true *within each engagement type*, not just for a
generic network pentest with cloud bolted on.

### 6. Supervised autonomy, not silent autonomy

The data is stark on why fully unsupervised autonomy underperforms: the same
benchmark that put human-in-the-loop success at 31–39% put fully autonomous
agents at 3–6%. Separately, a majority of organizations piloting agentic AI
for pentesting say they still prefer some human oversight over full
autonomy.

Nexra.sh's locked decision is no per-command approval gate, so the answer
here isn't a literal approval prompt — that would contradict the
architecture. It's **visibility and interrupt capability**: the shared
terminal dock already lets the operator watch execution live; the agent
should self-checkpoint and report at phase boundaries so a consultant can
catch a problem before it compounds, and the chat should stay interruptible
mid-run. This is "supervised autonomy," and it's a better match for the
existing dock design than pretending ungated means unwatched.

### 7. Findings that roll up into a client deliverable

Several competitors treat reporting as a first-class phase, not an
afterthought — NodeZero explicitly includes reporting and remediation-fix
verification as part of its automated pipeline. Nexra.sh's current roadmap
persists findings (M4) but has no requirement yet for turning them into
something a consultant hands to a client.

Requirement: findings logged across an engagement's chats need to export
into a structured, client-usable report (not just an in-app list) — this
should be scoped as its own line item, likely after M4 persistence lands and
before the app is called "shippable."

### 8. Independently checkable capability claims

The bar for credible claims in this space is currently low — XBOW's
headline ranking claim is disputed, and several open-source projects
advertise capabilities (e.g., full exploitation-framework integration) that
turn out to be roadmap items, not shipped behavior. Before claiming a phase
or engagement type is "supported," Nexra.sh should be able to point to a
real run against a known target (e.g., a GOAD-style Active Directory lab, a
HackTheBox-style box) rather than a description of intended behavior. This
is cheap relative to the trust it buys, given how low the bar already is
elsewhere in the space.

## Explicit non-requirements

- No custom or fine-tuned foundation model, ever. All competitive
  differentiation comes from orchestration, tool integration, safety
  architecture, and engagement-specific tradecraft around an off-the-shelf
  model.
- No "zero false positives" or "100% autonomous" claims. The research shows
  this is untrue industry-wide, and overclaiming here is a specific
  reputational risk given how publicly XBOW's own similar claims have
  already been disputed.

## Suggested mapping onto the existing roadmap

(`docs/superpowers/specs/2026-07-01-redcell-shipping-roadmap.md`)

| Requirement | Where it lands |
|---|---|
| 1. Tool execution breadth | M2 (`ShellService`) for the execution primitive; tool wiring itself is ongoing work threaded through M3 |
| 2. Multi-agent orchestration + memory | M3 (`AgentService`) — should be designed in from the start, not retrofitted |
| 3. Finding validation step | M3 (`AgentService`) + Findings panel — evidence capture is part of how a finding gets created |
| 4. Scope enforcement + prompt-injection defense | M2 (`ShellService` allowlist) and M3 (`AgentService` untrusted-input handling); this is the substance behind M6's existing "prompt-injection review" item |
| 5. Per-engagement-type tool depth | New work once M3's tool-calling contract exists — five tool packs, one per fixed engagement type |
| 6. Supervised autonomy (checkpoints, interrupts) | M3 (`AgentService`) alongside the existing composer busy-lock item |
| 7. Findings → client report export | Not currently on the roadmap — recommend adding as its own milestone after M4 (persistence), before v1 is called shippable |
| 8. Benchmarked capability claims | M6 (pre-ship hardening) — a real benchmark run belongs next to the security review, not in marketing copy |

## Where this came from

Full research findings (per-tool breakdown, sources, confidence levels) are
in this session's conversation history. This document distills that into
requirements; it is not itself the research record.
