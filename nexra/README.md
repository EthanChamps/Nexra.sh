# Nexra desktop application

The current project overview, setup, integration status and limitations are in the [root README](../README.md).

From this directory, with Node.js 22.12 or newer:

```bash
npm ci
npm test
npm run build
npm run dev
```

Tests and Electron use different native SQLite binaries. The npm lifecycle hooks rebuild the binary for the relevant runtime; run them sequentially.

The production entry point is `dist-electron/main.js`. Source lives in `src/` (React renderer), `electron/` (main/preload/services) and `test/` (Vitest). `npm run dist` builds unsigned installers and is separate from build verification.
