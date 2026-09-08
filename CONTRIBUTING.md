# Contributing

Start with the root [README](README.md), [architecture tour](docs/ARCHITECTURE.md) and [security boundaries](SECURITY.md). This is a public portfolio prototype with no open-source licence granted at present.

Use Node.js 22.12 or newer. From `nexra/`, run `npm ci`, then `npm test` and `npm run build` before submitting a change. Run tests and Electron sequentially because SQLite needs a different native binary for each runtime.

Keep changes focused and describe the concrete behaviour being fixed. Tests for agent changes should use deterministic model responses and lab-only tool fixtures; never make CI depend on cloud credentials or real client scans.

Preserve the renderer/preload/main-process boundary. Validate tool invocations before spawning, keep secrets out of command arguments, and document any new data sent to model providers. Do not introduce a general-purpose shell tool for the agent.

For bugs, include your OS, Node version, commit, reproduction steps and redacted output. Use private vulnerability reporting for security issues. Do not commit databases, environment files, logs, certificates or customer data.
