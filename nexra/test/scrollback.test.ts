import { describe, it, expect } from 'vitest'
import { ScrollbackBuffer } from '../electron/services/scrollback'

describe('ScrollbackBuffer', () => {
  it('replays pushed chunks in order', () => {
    const buf = new ScrollbackBuffer()
    buf.push('hello ')
    buf.push('world')
    expect(buf.read()).toBe('hello world')
  })

  it('evicts the oldest chunks once the byte cap is exceeded', () => {
    const buf = new ScrollbackBuffer(10)
    buf.push('0123456789') // exactly at cap, nothing evicted yet
    buf.push('abcde') // pushes total to 15 (>10) -> evicts the first chunk
    expect(buf.read()).toBe('abcde')
  })

  it('never evicts the last remaining chunk even if it alone exceeds the cap', () => {
    const buf = new ScrollbackBuffer(4)
    buf.push('this-single-chunk-is-longer-than-the-cap')
    expect(buf.read()).toBe('this-single-chunk-is-longer-than-the-cap')
  })
})
