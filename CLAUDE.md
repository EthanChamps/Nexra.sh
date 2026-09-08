# Nexra.sh development guide

Read README.md, docs/ARCHITECTURE.md and SECURITY.md for the current implementation. The dated docs/superpowers/ documents record earlier milestones and may be superseded.

## Current state

Electron + React/Vite app in nexra/. Live Anthropic/Ollama integration uses the Vercel AI SDK. SQLite persists projects, engagements, chats, settings, findings and scope. AWS, M365 and web tool packs are implemented. Other workspace categories have no dedicated tool packs.

## Working conventions

- Use Node.js 22.12 or newer and npm ci inside nexra/.
- Run npm test and npm run build for code changes. Tests and Electron must run sequentially because SQLite's native ABI differs.
- Keep renderer components behind window.nexra.*; do not import main-process services into the renderer.
- Agent execution uses typed tool wrappers with checks before spawning. The operator's terminal is separate and unrestricted.
- Preserve the existing visual language; the original reference is nexra/design-reference/Nexra.dc.html. Icons should communicate actions or status.
- Use fictional data in demos and deterministic fixtures in tests. Never commit real engagement data or credentials.
- Distinguish attached evidence from independently verified findings. Do not describe tests with mocked models as a live-model benchmark.
- Keep publication claims aligned with actual code and observed verification results.
