// Per-run de-identification for a (possibly remote) model. The web agent may run
// its LLM on separate hardware, so anything we put in a prompt leaves this
// machine. The client's IDENTITY lives in the hostname — never in the signal the
// model actually needs to pick the next action (status codes, tech, severities,
// path shapes). So we replace every real host with an opaque, stable handle
// (hN.masked.local) on the way OUT, and resolve the handle back to the real host
// on the way IN — before a skill spawns (so the real target is scanned) and for
// operator-facing display. Scope validation still runs on the resolved real URL,
// below the LLM. This costs the model nothing: it reasons over handles + paths
// exactly as it would over real hosts.

export interface Aliaser {
  // Ensure a handle exists for a real host; returns the handle host.
  registerHost(host: string): string
  // Rewrite every host (in URLs or bare, if known) to its handle. Assigns new
  // handles to hosts first seen here (e.g. endpoints surfaced in a summary).
  mask(text: string): string
  // Replace handle hosts with their real host — for operator display of
  // model-authored notes.
  unmask(text: string): string
  // Resolve any handle host inside a URL back to the real host so the skill runs
  // against the real target. Passthrough if the string carries no handle.
  resolveUrl(maybeMasked: string): string
}

const HANDLE_RE = /h\d+\.masked\.local/gi
// Matches an absolute http(s) URL up to the first whitespace/quote/bracket.
const URL_RE = /https?:\/\/[^\s"'<>)\]}]+/gi

function hostOf(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase() } catch { return null }
}

export function createAliaser(): Aliaser {
  const toHandle = new Map<string, string>()   // real host -> handle host
  const toReal = new Map<string, string>()     // handle host -> real host
  let n = 0

  function registerHost(host: string): string {
    const key = host.toLowerCase()
    let h = toHandle.get(key)
    if (!h) {
      h = `h${++n}.masked.local`
      toHandle.set(key, h)
      toReal.set(h, key)
    }
    return h
  }

  function mask(text: string): string {
    // 1) URLs: swap the host inside each, learning new hosts as we go.
    let out = text.replace(URL_RE, url => {
      const host = hostOf(url)
      if (!host) return url
      return url.replace(new RegExp(escapeRe(host), 'i'), registerHost(host))
    })
    // 2) Bare occurrences of hosts we already know (longest first so a parent
    //    domain can't shadow a longer subdomain).
    const known = [...toHandle.keys()].sort((a, b) => b.length - a.length)
    for (const real of known) {
      out = out.replace(new RegExp(`\\b${escapeRe(real)}\\b`, 'gi'), toHandle.get(real)!)
    }
    return out
  }

  function reveal(text: string): string {
    return text.replace(HANDLE_RE, h => toReal.get(h.toLowerCase()) ?? h)
  }

  return { registerHost, mask, unmask: reveal, resolveUrl: reveal }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
