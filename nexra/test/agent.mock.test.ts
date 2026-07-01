import { describe, it, expect, vi } from 'vitest'
import { runSend } from '../electron/services/agent.mock'
import type { AgentEvent } from '../electron/services/agent.types'

describe('agent mock send', () => {
  it('emits text, running tool, success tool, follow-up, done', async () => {
    vi.useFakeTimers()
    const events: AgentEvent[] = []
    const p = runSend({ chatId: 'ch1', engagementType: 'internal', phaseLabel: 'Recon', primaryTool: 'nmap', text: 'go' }, e => events.push(e))
    await vi.runAllTimersAsync(); await p
    const types = events.map(e => e.type)
    expect(types[0]).toBe('text')
    expect(events.some(e => e.type === 'tool_call' && e.state === 'running')).toBe(true)
    expect(events.some(e => e.type === 'tool_call' && e.state === 'success')).toBe(true)
    expect(types[types.length - 1]).toBe('done')
    vi.useRealTimers()
  })

  it('omits the phase clause (no doubled space) when phaseLabel is empty', async () => {
    vi.useFakeTimers()
    const events: AgentEvent[] = []
    const p = runSend({ chatId: 'ch1', engagementType: 'internal', phaseLabel: '', primaryTool: 'nmap', text: 'go' }, e => events.push(e))
    await vi.runAllTimersAsync(); await p
    const first = events[0]
    expect(first.type === 'text' && first.text).toBe('On it — running a targeted check across this engagement.')
    expect(first.type === 'text' && first.text.includes('  ')).toBe(false)
    vi.useRealTimers()
  })
})
