import { z } from 'zod'
import type { Severity } from './store.types'
import { normalizeSev } from './agent.findings'

// Deterministic reducers: raw tool JSON -> a compact model-facing summary + a
// list of severity-mapped candidate findings. The model curates these; it never
// parses raw tool output (small-model reliability + prompt-injection containment).

export interface WebCandidate { title: string; sev: Severity; host: string; detail: string }

function jsonLines(raw: string): any[] {
  return raw.split('\n').map(l => l.trim()).filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}

export function parseNucleiJsonl(raw: string): { summary: string; candidates: WebCandidate[] } {
  const candidates: WebCandidate[] = jsonLines(raw).map(r => ({
    title: r?.info?.name ?? r?.['template-id'] ?? 'nuclei finding',
    sev: normalizeSev(r?.info?.severity),
    host: r?.host ?? '',
    detail: `${r?.['template-id'] ?? ''} @ ${r?.['matched-at'] ?? r?.host ?? ''}`.trim(),
  }))
  if (!candidates.length) return { summary: 'nuclei: no findings.', candidates }
  const head = candidates.slice(0, 5).map(c => `[${c.sev.toLowerCase()}] ${c.title} — ${c.detail}`).join('; ')
  return { summary: `nuclei: ${candidates.length} finding(s) — ${head}${candidates.length > 5 ? '; …' : ''}`, candidates }
}

export function parseHttpxJson(raw: string): { summary: string; candidates: WebCandidate[] } {
  const rows = jsonLines(raw)
  if (!rows.length) return { summary: 'httpx: no live response.', candidates: [] }
  const r = rows[0]
  const tech = Array.isArray(r?.tech) ? r.tech.join(', ') : (r?.tech ?? '')
  return { summary: `httpx: ${r?.url ?? ''} → ${r?.status_code ?? '?'} "${r?.title ?? ''}"${tech ? ` [${tech}]` : ''}`, candidates: [] }
}

// ── Phase methodology + constrained-action schema ────────────────────────────
// The web engagement is a linear playbook; each phase exposes only its own
// skills to the model (a guardrail, not single-stepping) plus the always-present
// control actions. Aggressive tools (web_sqli) live in Verify so they cannot
// fire before the operator's phase checkpoint.
export const WEB_PHASES = [
  { id: 'map',      label: 'Map',      skills: ['web_probe'], budget: 3 },
  { id: 'discover', label: 'Discover', skills: ['web_crawl', 'web_content_discovery'], budget: 6 },
  { id: 'scan',     label: 'Scan',     skills: ['web_scan', 'web_headers_tls'], budget: 6 },
  { id: 'verify',   label: 'Verify',   skills: ['web_sqli'], budget: 6 },
  { id: 'report',   label: 'Report',   skills: [], budget: 2 },
] as const

const CONTROL_ACTIONS = ['log_finding', 'attach_evidence', 'request_inputs', 'checkpoint', 'done']

export function allowedActionsForPhase(phaseLabel: string): string[] {
  const p = WEB_PHASES.find(p => p.label.toLowerCase() === phaseLabel.toLowerCase())
  return [...(p?.skills ?? []), ...CONTROL_ACTIONS]
}

export interface WebAction { action: string; url?: string; finding?: { title: string; sev: string; rationale: string; evidenceRef?: string }; note?: string }

export function webActionSchema(phaseLabel: string) {
  const actions = allowedActionsForPhase(phaseLabel)
  return z.object({
    action: z.enum(actions as [string, ...string[]]),
    url: z.string().optional(),
    finding: z.object({ title: z.string(), sev: z.string(), rationale: z.string(), evidenceRef: z.string().optional() }).optional(),
    note: z.string().optional(),
  })
}

export function parseStructuredAction(raw: string, phaseLabel: string): WebAction | null {
  let obj: unknown
  try { obj = JSON.parse(raw) } catch { return null }
  const parsed = webActionSchema(phaseLabel).safeParse(obj)
  return parsed.success ? parsed.data as WebAction : null
}

export function summarizeSkill(skill: string, raw: string): { summary: string; candidates: WebCandidate[] } {
  switch (skill) {
    case 'web_scan': return parseNucleiJsonl(raw)
    case 'web_probe': return parseHttpxJson(raw)
    case 'web_crawl': {
      const eps = jsonLines(raw).map(r => r?.endpoint ?? r?.url).filter(Boolean)
      return { summary: `katana: ${eps.length} endpoint(s) discovered${eps.length ? ` (e.g. ${eps.slice(0, 3).join(', ')})` : ''}`, candidates: [] }
    }
    case 'web_content_discovery': {
      let paths: string[] = []
      try { paths = (JSON.parse(raw)?.results ?? []).map((r: any) => r.url).filter(Boolean) } catch { /* ignore */ }
      return { summary: `ffuf: ${paths.length} path(s) found${paths.length ? ` (e.g. ${paths.slice(0, 3).join(', ')})` : ''}`, candidates: [] }
    }
    case 'web_headers_tls': {
      let d: any = {}; try { d = JSON.parse(raw) } catch { /* ignore */ }
      const cands: WebCandidate[] = (d.missing ?? []).map((h: string) => ({ title: `Missing security header: ${h}`, sev: normalizeSev('low'), host: d.host ?? '', detail: `${h} not set on ${d.host ?? ''}` }))
      if (d?.tls?.weak) cands.push({ title: 'Weak TLS configuration', sev: normalizeSev('medium'), host: d.host ?? '', detail: `weak TLS on ${d.host ?? ''}` })
      return { summary: `headers/tls: ${cands.length} issue(s)${cands.length ? ` — ${cands.map(c => c.title).slice(0, 4).join('; ')}` : ''}`, candidates: cands }
    }
    case 'web_sqli': {
      const injectable = /is vulnerable|sqlmap identified the following injection/i.test(raw)
      return injectable
        ? { summary: 'sqlmap: injection CONFIRMED on the tested parameter.', candidates: [{ title: 'SQL injection confirmed', sev: normalizeSev('high'), host: '', detail: 'sqlmap confirmed an injectable parameter' }] }
        : { summary: 'sqlmap: no injection confirmed on the tested URL.', candidates: [] }
    }
    default: {
      const first = raw.split('\n').map(l => l.trim()).find(Boolean) ?? ''
      return { summary: `${skill}: ${first.slice(0, 200) || 'completed, no parsable output'}`, candidates: [] }
    }
  }
}
