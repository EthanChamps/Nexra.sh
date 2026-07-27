import { describe, it, expect } from 'vitest'
import { decideWebAction } from '../electron/services/agent.decide'

describe('decideWebAction', () => {
  it('returns the parsed action from schema-constrained JSON', async () => {
    const a = await decideWebAction({
      generate: async () => ({ text: JSON.stringify({ action: 'web_scan', url: 'https://app.acme.com' }) }),
      system: 'sys', messages: [], phaseLabel: 'Scan', signal: new AbortController().signal,
    })
    expect(a).toMatchObject({ action: 'web_scan', url: 'https://app.acme.com' })
  })
  it('returns null when the model emits an out-of-phase / malformed action (caller repairs)', async () => {
    const a = await decideWebAction({
      generate: async () => ({ text: JSON.stringify({ action: 'web_sqli', url: 'x' }) }),
      system: 'sys', messages: [], phaseLabel: 'Scan', signal: new AbortController().signal,
    })
    expect(a).toBeNull()
  })
})
