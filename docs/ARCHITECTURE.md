# Architecture and code tour

Nexra separates the desktop interface from model calls, persistent state and process execution. The main design question is how to let an agent use useful security tools while keeping the operator's targets and evidence explicit.

## Start with these files

| File | What to look for |
| --- | --- |
| [`agent.live.ts`](../nexra/electron/services/agent.live.ts) | Streaming cloud-review loop and separate structured web loop, checkpoints, output recording and finding persistence. |
| [`agent.decide.ts`](../nexra/electron/services/agent.decide.ts) | Structured model output and validation; invalid decisions return to a bounded repair path. |
| [`agent.web.ts`](../nexra/electron/services/agent.web.ts) | Phase-specific allowed actions, budgets and deterministic tool-output parsers. |
| [`agent.tools.ts`](../nexra/electron/services/agent.tools.ts) | Scope and required-input checks before process creation; command arguments built by fixed wrappers. |
| [`scope.web.ts`](../nexra/electron/services/scope.web.ts) | Web target matching, host allowlists, exclusions and URL prefixes. |
| [`agent.alias.ts`](../nexra/electron/services/agent.alias.ts) | Host aliases in model-facing web context. This is data minimisation, not complete anonymisation. |
| [`agent.findings.ts`](../nexra/electron/services/agent.findings.ts) | Captured-output references and evidence rules. |
| [`store.graph.ts`](../nexra/electron/services/store.graph.ts) | Saving and restoring the project/engagement/chat graph. |
| [`secrets.vault.ts`](../nexra/electron/services/secrets.vault.ts) | Secret metadata separated from values; decryption for process environment injection. |
| [`main.ts`](../nexra/electron/main.ts) | IPC wiring, runtime settings and desktop lifecycle. |

## Web assessment flow

1. The operator creates an engagement and sets its target scope.
2. The current phase selects a set of allowed actions and a step budget.
3. The model proposes a schema-constrained action. Invalid output gets one correction attempt for that step.
4. A fixed wrapper validates the requested URL before launching a tool. Missing scope or required inputs stop execution.
5. The application captures output, reduces it into a compact summary and creates candidate findings from recognised results.
6. Model-facing summaries use host aliases; the local findings retain evidence for the operator.
7. A checkpoint or exhausted budget ends the phase turn. The operator chooses whether to continue.

AWS and M365 use a separate streaming loop with parsed skill-call markers. They do not use the web action schema, so web-specific guarantees should not be attributed to every engagement type.

## Design tradeoffs

**Typed skills over a model-controlled shell.** Fixed wrappers make it possible to validate arguments and test rejection before process creation. They also require a new integration for every supported tool. The operator still has a separate unrestricted terminal.

**Deterministic summaries over raw web-tool transcripts.** Parsers reduce context size and exposure to arbitrary tool output, but can miss new output formats. Summaries still contain externally influenced text; they are not a proof against prompt injection.

**Local persistence over hosted collaboration.** SQLite keeps the prototype self-contained and retains work across restarts. It does not provide multi-user access control, encrypted transcripts or shared engagement management.

**Evidence attachment over model confidence.** Findings carry evidence instead of a model's unsupported confidence score. Evidence presence is weaker than independent verification of a vulnerability.

## Runtime boundaries

Renderer components use `window.nexra.*` through the preload bridge, rather than importing backend services. The main process owns model access, the database and child processes. Context isolation is enabled and renderer Node integration is disabled; the Electron sandbox is currently disabled.

Secrets are encrypted through Electron `safeStorage` before their values are saved. General chat and finding data are ordinary SQLite records. Child tools receive credentials through environment variables; their output must still be treated as potentially sensitive.

See [SECURITY.md](../SECURITY.md) for the practical limits of these boundaries.
