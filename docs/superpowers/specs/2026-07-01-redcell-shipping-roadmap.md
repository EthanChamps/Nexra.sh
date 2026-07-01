# Redcell — Shipping Roadmap (M1 → shippable)

**Date:** 2026-07-01
**Status:** Approved (roadmap)
**Author:** planning session

## What "shipped" means for v1

Ship target decisions (locked with the user, 2026-07-01):

- **Audience:** internal — you and your team run it on real engagements. No
  distribution, so **no auto-update / licensing / billing / marketing site**.
- **Platforms:** **macOS + Windows both** at v1 (matches the original spec).
- **Execution model:** **fully ungated** — the agent runs commands
  autonomously with no per-command approval prompt (the architecture's locked
  end state).

**Definition of done for v1:** you can run a complete client engagement
end-to-end on both a Mac and a Windows box — real interactive terminals, a live
Claude agent that autonomously executes commands and logs findings, everything
persisted across restarts — installed from a signed/notarized installer, with a
security review passed.

## The milestones

Each milestone is one development branch built with the same process that
produced M1 (see "Process" below). The mock service boundary
(`window.redcell.*`) means every milestone replaces exactly one backend with
**zero UI changes**.

| M  | Name                        | Ships                                                                                                   | Backend touched          |
|----|-----------------------------|---------------------------------------------------------------------------------------------------------|--------------------------|
| 0  | Safety net                  | GitHub remote + push; CI (`npm test` + `tsc --noEmit` + `vite build`) on macOS **and** Windows runners  | none (infra only)        |
| 2  | Real terminals              | `node-pty` in `ShellService`; buffers survive dock close/reopen; sessions killed on chat/app close      | `ShellService`           |
| 3  | Live agent                  | Vercel AI SDK v6 + Claude in `AgentService`; ungated tool-calling drives M2 shells; findings; busy-lock; Settings wired to real providers | `AgentService`           |
| 4  | Persistence                 | `better-sqlite3` in `StoreService`; projects/engagements/chats/messages/findings survive restart; schema-migration test | `StoreService`           |
| 5  | Cross-platform + packaging  | Verified Windows run (incl. WSL-Kali shell); bump `electron-builder` to `^26`; signed + notarized macOS & Windows installers | build/packaging          |
| 6  | Pre-ship hardening          | `/security-review`; OS-keychain API-key storage; prompt-injection review; crash/error handling; live dogfood pass | cross-cutting            |

> Numbering keeps M1 = the shipped UI shell. There is no separate "M7
> commercial track" — dropped because v1 is internal-only. The architecture
> stays clean enough to add it later without rework.

## Sequencing and rationale

- **M0 first** — cheap insurance. The repo is local-only today; one disk
  failure loses everything. When AI writes 100% of the code, CI is the only
  *independent* verifier of correctness — without it, the sole check is whatever
  the session that wrote the code asserts about itself.
- **M2 before M3** — the agent's ungated tool-calls need *real* shells to
  drive. node-pty is also the riskiest native dependency (Electron ABI
  rebuilds, per-platform prebuilds); surface that risk early.
- **M3 before M4** — persist the message/finding shapes only once the live
  agent has settled them; avoids a schema rewrite.
- **M4 before M5** — package once the app is functionally complete.
- **M5 + M6 overlap** at the end — signing/notarization has calendar latency
  (cert issuance, Apple notarization queue) that hardening work can run beside.

## Process (every milestone)

Unchanged from M1 and mandated by `CLAUDE.md`:

`superpowers:brainstorming` → spec (`docs/superpowers/specs/`) →
`superpowers:writing-plans` → plan (`docs/superpowers/plans/`) →
`superpowers:subagent-driven-development` (fresh implementer subagent per task
with TDD, fresh reviewer subagent per task, fix loop on findings, final
whole-branch review on the most capable model) →
`superpowers:finishing-a-development-branch` (merge).

**Spec cadence:** one spec per milestone, written **just-in-time** as we start
it — M3's tool-calling contract and M5's signing details will be far clearer
after M2 lands than they are today. This roadmap is the only up-front
cross-milestone document. M0 + M2 are specced now (see
`2026-07-01-redcell-m0-m2-design.md`); M3–M6 are specced when reached.

## Cross-cutting risks to watch

- **node-pty × Electron ABI** (M2): native module must be rebuilt for
  Electron's Node ABI and prebuilt per platform/arch. First thing to prove.
- **Ungated execution safety** (M3/M6): arbitrary command execution + stored
  API keys is a real attack surface. M6's security review is non-negotiable
  *because* execution is ungated — it is not optional polish.
- **Code signing latency** (M5): Apple Developer cert + notarization, and a
  Windows Authenticode cert (OV/EV), both have external lead time. Start
  procurement during M4, not M5.
- **Secret handling** (M3/M6): API keys must live in the OS keychain
  (Keychain / Credential Manager), never plaintext on disk.

## Where things live

- This roadmap: `docs/superpowers/specs/2026-07-01-redcell-shipping-roadmap.md`
- M0 + M2 spec: `docs/superpowers/specs/2026-07-01-redcell-m0-m2-design.md`
- M1 spec / plan / handover: see `docs/superpowers/` and
  `docs/superpowers/HANDOVER.md`
