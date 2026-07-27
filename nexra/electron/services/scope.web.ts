import type { EngagementScope } from './store.types'

// Pure URL normalization + scope matching for the web vertical, enforced BELOW
// the LLM. A candidate URL is only in scope if it parses to http(s), its host
// is on the allowlist (exact or a label-boundary wildcard), it is not excluded,
// and — when urlPrefixes is set — it sits under one. Empty allowlist fails closed.

export function normalizeUrl(raw: string): { host: string; url: string } | null {
  let u: URL
  try { u = new URL(raw) } catch { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  const host = u.hostname.toLowerCase()   // URL already lowercases; explicit for clarity
  // URL resolves ./ and ../ in pathname and strips default ports from origin.
  const pathname = u.pathname.replace(/\/{2,}/g, '/')
  return { host, url: `${u.protocol}//${host}${u.port ? ':' + u.port : ''}${pathname}${u.search}` }
}

export function hostMatches(host: string, hosts: string[], wildcards: string[]): boolean {
  if (hosts.some(h => h.toLowerCase() === host)) return true
  return wildcards.some(w => {
    const suffix = w.replace(/^\*/, '').toLowerCase()   // "*.acme.com" -> ".acme.com"
    return suffix.startsWith('.') && host.endsWith(suffix) && host.length > suffix.length
  })
}

export function isExcluded(host: string, url: string, exclusions: string[]): boolean {
  return exclusions.some(e => {
    const x = e.toLowerCase()
    if (x.startsWith('http://') || x.startsWith('https://')) return url.toLowerCase().startsWith(x)
    return host === x || host.endsWith('.' + x)
  })
}

export function validateWebTarget(rawUrl: string | undefined, scope: EngagementScope): { allowed: boolean; reason?: string } {
  const hosts = scope.hosts ?? [], wildcards = scope.wildcards ?? [], prefixes = scope.urlPrefixes ?? [], exclusions = scope.exclusions ?? []
  if (hosts.length === 0 && wildcards.length === 0 && prefixes.length === 0)
    return { allowed: false, reason: 'web scope allowlist is empty — nothing is in scope' }
  if (!rawUrl) return { allowed: false, reason: 'target URL required' }
  const n = normalizeUrl(rawUrl)
  if (!n) return { allowed: false, reason: `target ${rawUrl} is not a valid http(s) URL` }
  if (isExcluded(n.host, n.url, exclusions)) return { allowed: false, reason: `${n.host} is explicitly excluded from scope` }
  if ((hosts.length || wildcards.length) && !hostMatches(n.host, hosts, wildcards))
    return { allowed: false, reason: `host ${n.host} is out of scope` }
  if (prefixes.length && !prefixes.some(p => n.url.toLowerCase().startsWith(p.toLowerCase())))
    return { allowed: false, reason: `${n.url} is not under an in-scope path prefix` }
  return { allowed: true }
}
