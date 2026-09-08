# Verification

## Publication checks — 8 September 2026

| Check | Observed result |
| --- | --- |
| Windows, Node 22.14.0: `npm test` | 331 tests passed across 65 files. |
| `npm run build` | Renderer, main process and preload built; TypeScript checks passed. Vite reports a large renderer bundle warning. |
| `npm run predev` | Native SQLite rebuild for Electron 42.11.2 and runtime asset copy passed on Windows. |
| Windows desktop smoke check | Launched the built app, created a fictional project/engagement/chat, reloaded and recovered the project, and saved/reopened a custom model setting. Settings offered only Anthropic/Ollama. |
| Visual check | Reviewed the actual workspace and Settings, including the 1080 × 680 minimum window; the checked controls fit without document overflow. [Workspace](images/workspace.png), [Settings](images/settings.png). |
| `npm audit` | Zero reported vulnerabilities after updating the dependency lockfile. This is a point-in-time advisory check, not a security certification. |
| Gitleaks 8.30.1, all fetched Git history | 230 existing commits scanned; no secret detections. Automated scanning cannot guarantee absence of sensitive information. |
| CI | Windows and macOS test/build jobs are defined in [the workflow](../.github/workflows/ci.yml); the badge links to current results. |

The suite still produces some React test `act` warnings and jsdom canvas warnings. Native Windows terminal cleanup can also emit a ConPTY diagnostic. These were not failing assertions in the recorded run.

## What the tests cover

- **Invocation controls:** an out-of-scope target or missing required input prevents process creation.
- **Web orchestration:** phase-specific actions, structured decision parsing, bounded repair, checkpoints and candidate findings.
- **Information handling:** selected host-alias and redaction paths, plus separation of secret metadata from stored values.
- **Evidence:** recording tool output, linking findings and storing evidence.
- **Persistence:** database migrations, graph restoration, deletion, findings and scope surviving a reopen.
- **Native boundaries:** real SQLite operations and real terminal process creation/output/termination.
- **Interface behaviour:** project state, chat rendering, settings, inputs and autosave.

Most agent tests replace the model with scripted responses and substitute deterministic tool output. They validate application behaviour. They do not measure live model judgement, vulnerability detection accuracy or resistance to arbitrary prompt injection. Electron secure storage is mocked in Node tests; that is not an OS keychain integration test.

## Reproduce

From `nexra/`:

```bash
npm ci
npm test
npm run build
npm audit
```

Do not run Electron at the same time as `npm test` in one checkout: the SQLite native dependency is rebuilt for each runtime.

## Next evaluation: live model quality

Use a local lab with known expected results and no real client data. Record the model/version, tool-image digests, configuration, input, expected outcome and observed outcome for each case. Repeat each case to expose variation.

Include an allowed target, an out-of-scope proposal, malformed model output, a missing tool, misleading tool text, duplicate scan requests and a scan with known findings. Report scope violations, completed tasks, false positives, missed findings, elapsed time and model token usage/cost. Publish failures alongside successes.

No live-model benchmark results are claimed in this repository yet.
