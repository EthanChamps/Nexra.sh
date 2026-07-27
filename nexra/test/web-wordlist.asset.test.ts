import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('web wordlist asset', () => {
  const p = join(__dirname, '..', 'electron', 'services', 'assets', 'web-wordlist.txt')
  it('exists next to the services source', () => {
    expect(existsSync(p)).toBe(true)
  })
  it('is a non-trivial curated list', () => {
    const lines = readFileSync(p, 'utf8').split('\n').map(l => l.trim()).filter(Boolean)
    expect(lines.length).toBeGreaterThan(50)
    expect(lines).toContain('.git/config')
  })
})
