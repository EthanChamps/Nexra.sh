# Security boundaries

Nexra is a development prototype for authorised assessments. It launches real tools with the local user's permissions. Review this document before connecting real credentials or client environments.

## Implemented controls

- Typed wrappers check the requested target against stored engagement scope before spawning a child process.
- Missing required credential fields block a tool and request operator input.
- Secret values use Electron `safeStorage`; secret metadata and encrypted values are stored separately. Storage refuses secret writes when secure storage is unavailable.
- Web actions are phase-specific, schema-validated and bounded by step budgets.
- Web containers drop Linux capabilities, disable privilege escalation and limit process counts.
- The renderer uses context isolation with Node integration disabled.

## Limits

- **Scope is an invocation check, not a network firewall.** Redirects, crawling and a tool's own requests can reach beyond the submitted URL. Container egress restrictions are not implemented.
- **Cloud scope is not identity attestation.** Checking an account or tenant argument does not independently prove that the supplied credentials belong to it, or that an external tool limits all of its work to it.
- **The operator terminal bypasses agent scope controls by design.** It is a real local shell.
- **Tool output can contain sensitive content.** Keeping credentials out of arguments and prompts does not guarantee that an external tool will never print them. Chat, output and findings are not encrypted as a whole.
- **Cloud providers receive prompt content.** Host aliasing applies to the web loop, not every message or engagement. Avoid sending confidential material without appropriate authorisation.
- **Prompt injection remains a risk.** Deterministic tests verify selected enforcement paths; they do not prove resistance to arbitrary adversarial model inputs.
- **A finding marked `verified` has attached evidence, not independently confirmed exploitability.**
- **Docker images currently use `latest` tags.** They are not reproducibly pinned to digests.
- **Cancelling a model turn does not guarantee an already-running external tool is terminated.**
- **Electron sandboxing is disabled.** Installer signing, platform hardening and a complete independent security review remain outstanding.

Prefer fictional data, isolated lab targets and narrowly scoped credentials while evaluating the prototype. Keep the application database, terminal output and exported assessment data outside Git.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/EthanChamps/Nexra.sh/security/advisories/new). Include the affected commit, a minimal reproduction using fictional data, and the expected versus observed behaviour. Do not put credentials or client assessment details in public issues.
