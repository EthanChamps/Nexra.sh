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

export function summarizeSkill(skill: string, raw: string): { summary: string; candidates: WebCandidate[] } {
  switch (skill) {
    case 'web_scan': return parseNucleiJsonl(raw)
    case 'web_probe': return parseHttpxJson(raw)
    default: {
      const first = raw.split('\n').map(l => l.trim()).find(Boolean) ?? ''
      return { summary: `${skill}: ${first.slice(0, 200) || 'completed, no parsable output'}`, candidates: [] }
    }
  }
}
