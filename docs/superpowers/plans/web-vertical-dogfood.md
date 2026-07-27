# Web Vertical — Dogfood Runbook

One authorised, in-scope run that proves the web vertical end-to-end on the
operator's own machine. This is the "proof, not description" gate (mirrors the
AWS one-real-run in HANDOVER Phase 6).

## Prerequisites

1. **Docker running.** Pull the pinned tool images and build the first-party
   headers/TLS image:
   ```bash
   docker pull projectdiscovery/httpx:latest
   docker pull projectdiscovery/nuclei:latest
   docker pull projectdiscovery/katana:latest
   docker pull ffuf/ffuf:latest
   docker pull ghcr.io/sqlmapproject/sqlmap:latest
   docker build -t nexra/web-headers-tls:latest nexra/docker/web-headers-tls
   ```
2. **Ollama serving Gemma 3** (12B–27B), e.g. `ollama run gemma3:27b` then stop;
   set the provider to Ollama + that model in Settings.
3. **A deliberately vulnerable, authorised target.** Recommended: local OWASP
   Juice Shop —
   ```bash
   docker run --rm -d -p 3000:3000 bkimminich/juice-shop
   ```
   Target `http://localhost:3000`.

## Container/auth pattern spike (Task 5 Step 5 verification)

Confirm the env-passthrough + shell-expansion pattern works with the real image
(the header value must never appear in argv, only in container env):
```bash
docker run --rm -e WEB_AUTH_HEADER --entrypoint sh projectdiscovery/httpx:latest \
  -c 'httpx -u "$1" -json -silent ${WEB_AUTH_HEADER:+ -H "$WEB_AUTH_HEADER"}' nexra http://localhost:3000
```
Expected: one JSON line describing the response. If an image lacks `/bin/sh`,
switch that skill to a shell-bearing tag and record it in `agent.tools.ts`.

## The run

1. Create a **Web App Pen Test** engagement. Set enforced scope:
   `hosts: [localhost]`, `exclusions: []` (add an out-of-scope host, e.g.
   `example.com`, purely to prove denial below).
2. If testing authenticated surface: log into Juice Shop, copy the session
   `Authorization`/`Cookie` header, and provide it when the agent requests
   `WEB_AUTH_HEADER` (it is injected into the container, never shown to the model).
3. Drive the phases: **Map → Discover → Scan → Verify**, clicking **Continue**
   at each checkpoint card.

## Pass criteria (assert all)

- [ ] Each phase runs only its allowed skills; the loop **pauses at a checkpoint**
      between phases and resumes on Continue.
- [ ] `web_sqli` never fires before the **Verify** phase checkpoint.
- [ ] Findings are logged **with evidence**; severities come from the tools, not
      the model.
- [ ] Proposing/deriving an **out-of-scope** URL (e.g. `http://example.com`) is
      **denied** and no container spawns for it.
- [ ] The session `WEB_AUTH_HEADER` value appears in **no** tool-card command or
      output shown in the UI.
- [ ] No leftover containers: `docker ps -a` is clean afterwards (`--rm` verified).
- [ ] Raw target HTML/JS never appears in the model's context — only the
      structured per-skill summaries do.

Record the result (screenshots + `docker ps -a`) alongside this file.
