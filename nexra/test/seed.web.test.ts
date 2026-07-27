import { describe, it, expect } from 'vitest'
import { buildTypes } from '../electron/services/seed'

describe('web engagement type', () => {
  it('defines a linear 5-phase web methodology', () => {
    const web = buildTypes().web
    expect(web).toBeTruthy()
    expect(web.linear).toBe(true)
    expect(web.phases.map(p => p.id)).toEqual(['map', 'discover', 'scan', 'verify', 'report'])
  })
  it('carries web scope display rows', () => {
    const labels = buildTypes().web.scope.map(s => s.label)
    expect(labels).toEqual(expect.arrayContaining(['In-scope hosts', 'Exclusions']))
  })
})
