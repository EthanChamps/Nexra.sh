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

## Secure split-compute setup (model on separate hardware)

The Windows box lacks the compute to host the LLM, so the model runs on a
separate machine (e.g. a Mac mini) while all execution, data, and findings stay
on the Windows box. The app supports this with **no code change** — set
provider `ollama` and `baseUrl` to the model host. What follows keeps that split
secure. The in-app controls (host de-identification, cleartext-transport
warning, local titling, container hardening) are already wired; these are the
operator/infra steps that can't be automated from the app.

**What already protects you in-app (implemented):**
- **Host de-identification** — every real hostname is replaced with an opaque
  handle (`hN.masked.local`) before any prompt leaves the box, and resolved back
  locally before a skill spawns (`agent.alias.ts`). The model sees
  `h1.masked.local/admin → 200 [nginx]`, never the client's domain. Findings are
  stored locally with the **real** host; only model-bound text is masked.
- **Cleartext-transport warning** — if `baseUrl` is plain `http://` to a
  non-loopback host, the app logs a warning (`modelTransportWarning`). Treat it
  as a blocker: set up the tunnel below.
- **Local chat titles** — titles are derived on-device for the local provider,
  so the first message is never shipped just to name a chat.
- **Container hardening** — every tool container runs `--cap-drop ALL
  --security-opt no-new-privileges --pids-limit 512`, `--rm`, and a read-only
  wordlist mount.

**Operator steps (do these before a real engagement):**

1. **Encrypt + authenticate the model channel.** Do NOT expose Ollama on the open
   LAN. Preferred: a **WireGuard** tunnel between the two machines (or `ssh -L
   11434:localhost:11434 mini`), then bind Ollama to loopback only and point the
   app at the tunnel:
   ```bash
   # On the mini — bind to localhost, reachable only through the tunnel:
   launchctl setenv OLLAMA_HOST "127.0.0.1:11434"      # NOT 0.0.0.0
   # App baseUrl on Windows → the tunnel endpoint, e.g. http://localhost:11434
   ```
   With the tunnel terminating on localhost, the cleartext-transport warning
   stays silent (loopback) and the traffic is encrypted end to end.
2. **Firewall the mini** to accept the model/tunnel port only from the Windows
   box's address. Everything else denied.
3. **Encrypt data at rest on both ends.** Windows: BitLocker on the drive holding
   `%APPDATA%\nexra\nexra.db` (the single file with all engagement data +
   DPAPI-encrypted secrets). Mini: FileVault on, so any transient prompt buffers
   / Ollama logs sit on an encrypted volume.
4. **Trim the model host's logging.** Ollama request logs can retain prompts
   (de-identified, but still) — disable or rotate them; the mini keeps no
   engagement record you didn't intend.
5. **Destroy after.** Close the app, delete `%APPDATA%\nexra\nexra.db`, and
   `docker image prune -a`. Nothing durable survives.

**Known v1 limitation:** container egress is unrestricted (a tool can reach the
internet, not just the target). Full egress allowlisting needs per-target
network rules and is deferred. Mitigate by running engagements from a network
segment you control.

- [ ] Tunnel up; `baseUrl` points at the loopback tunnel endpoint; no cleartext
      warning in the log.
- [ ] Capture one outbound prompt (app log / tunnel) and confirm it contains
      `masked.local` handles and **no** real client hostname.
