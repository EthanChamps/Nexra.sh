import { describe, it, expect } from 'vitest'
import { track, untrack } from '../electron/services/inflight'

describe('inflight — overlapping-stream guard', () => {
  it('aborts the previous controller when a new stream starts for the same chat', () => {
    const inflight = new Map<string, AbortController>()
    const ctrlA = track(inflight, 'c1')
    expect(ctrlA.signal.aborted).toBe(false)
    const ctrlB = track(inflight, 'c1')
    expect(ctrlA.signal.aborted).toBe(true)     // old stream cancelled
    expect(ctrlB.signal.aborted).toBe(false)    // new stream is live
    expect(inflight.get('c1')).toBe(ctrlB)
  })

  it('does not abort or interfere with a different chat', () => {
    const inflight = new Map<string, AbortController>()
    const ctrlA = track(inflight, 'c1')
    const ctrlOther = track(inflight, 'c2')
    expect(ctrlA.signal.aborted).toBe(false)
    expect(ctrlOther.signal.aborted).toBe(false)
  })

  it('untrack only removes the map entry if it still belongs to the caller (stale cleanup guard)', () => {
    const inflight = new Map<string, AbortController>()
    const ctrlA = track(inflight, 'c1')
    const ctrlB = track(inflight, 'c1')   // supersedes A; inflight.get('c1') === ctrlB
    untrack(inflight, 'c1', ctrlA)        // A's own (late) cleanup — must NOT remove B's entry
    expect(inflight.get('c1')).toBe(ctrlB)
    untrack(inflight, 'c1', ctrlB)        // B's own cleanup — removes it
    expect(inflight.get('c1')).toBeUndefined()
  })
})
