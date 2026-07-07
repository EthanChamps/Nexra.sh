import { describe, it, expect } from 'vitest'
import { formatElapsed, tailLines, workingLabel } from '../src/lib/progress'
import type { Message } from '../electron/services/store.types'

describe('formatElapsed', () => {
  it('formats zero as 0:00', () => { expect(formatElapsed(0)).toBe('0:00') })
  it('zero-pads seconds under a minute', () => { expect(formatElapsed(47_000)).toBe('0:47') })
  it('formats minutes and seconds', () => { expect(formatElapsed(185_000)).toBe('3:05') })
  it('floors sub-second remainders', () => { expect(formatElapsed(1_900)).toBe('0:01') })
  it('does not cap minutes', () => { expect(formatElapsed(3_723_000)).toBe('62:03') })
})

describe('tailLines', () => {
  it('returns the whole string when fewer than n lines', () => {
    expect(tailLines('a\nb', 7)).toBe('a\nb')
  })
  it('keeps only the last n lines when there are more', () => {
    const input = ['l01', 'l02', 'l03', 'l04', 'l05', 'l06', 'l07', 'l08'].join('\n')
    expect(tailLines(input, 7)).toBe(['l02', 'l03', 'l04', 'l05', 'l06', 'l07', 'l08'].join('\n'))
  })
  it('drops a single trailing newline before taking the tail', () => {
    expect(tailLines('a\nb\n', 7)).toBe('a\nb')
  })
  it('returns empty string for empty input', () => {
    expect(tailLines('', 7)).toBe('')
  })
})

describe('workingLabel', () => {
  it('defaults to Working… for an empty list', () => {
    expect(workingLabel([])).toBe('Working…')
  })
  it('says Reviewing scan output… after a finished scan card', () => {
    const msgs = [{ id: 't1', role: 'assistant', kind: 'tool', state: 'success' }] as unknown as Message[]
    expect(workingLabel(msgs)).toBe('Reviewing scan output…')
  })
  it('says Resuming… after a request card', () => {
    const msgs = [{ id: 'r1', role: 'assistant', kind: 'request', requestKind: 'inputs' }] as unknown as Message[]
    expect(workingLabel(msgs)).toBe('Resuming…')
  })
  it('says Working… for a plain trailing message', () => {
    const msgs = [{ id: 'u1', role: 'user', kind: 'text', content: 'hi' }] as unknown as Message[]
    expect(workingLabel(msgs)).toBe('Working…')
  })
  it('ignores a still-running tool card (no output-review implied)', () => {
    const msgs = [{ id: 't1', role: 'assistant', kind: 'tool', state: 'running' }] as unknown as Message[]
    expect(workingLabel(msgs)).toBe('Working…')
  })
})
