import { describe, it, expect, vi } from 'vitest'
import { spawn as nodeSpawn } from 'node:child_process'
import { runSkill, cleanBaseEnv, type SkillDef, type SkillInvocation, type RunDeps } from '../electron/services/agent.tools'
import type { AgentEvent } from '../electron/services/agent.types'
import type { EngagementScope } from '../electron/services/store.types'

const SECRET_VALUE = 'super-secret-value-xyz-9000'

// A fake skill: a node child that reports whether the credential reached its
// env WITHOUT ever printing the value — exactly how a real tool behaves.
const CRED_PROBE = `process.stdout.write(process.env.AWS_SECRET_ACCESS_KEY ? 'CRED_PRESENT' : 'CRED_ABSENT')`
const probeSkill: SkillDef = { name: 'probe', build: () => ({ command: process.execPath, args: ['-e', CRED_PROBE] }) }

const inv: SkillInvocation = { skill: 'probe', companyId: 'c1', engagementId: 'e1', account: '111111111111', region: 'us-east-1' }

function baseDeps(over: Partial<RunDeps> = {}): RunDeps {
  return {
    getScope: () => ({ mode: 'all', accounts: [], regions: [] }),
    injectEnv: () => ({ AWS_SECRET_ACCESS_KEY: SECRET_VALUE }),
    filledEnvVars: () => ['AWS_SECRET_ACCESS_KEY'],
    baseEnv: { PATH: process.env.PATH },
    ...over,
  }
}

function collect() {
  const events: AgentEvent[] = []
  return { events, emit: (e: AgentEvent) => events.push(e) }
}

describe('runSkill — the "AI uses but cannot see" guarantee', () => {
  it('injects the credential into the child env, but never into agent-facing events', async () => {
    const { events, emit } = collect()
    const result = await runSkill(inv, probeSkill, emit, baseDeps())

    expect(result).toEqual({ state: 'success', exitCode: 0 })

    // The child SAW the credential (it could log into AWS) ...
    const childOutput = events.filter(e => e.type === 'skill' && e.state === 'output').map(e => (e as any).chunk).join('')
    expect(childOutput).toBe('CRED_PRESENT')

    // ... but the agent's whole view of the run contains the value NOWHERE.
    const agentView = JSON.stringify(events)
    expect(agentView).not.toContain(SECRET_VALUE)
    expect(agentView).toContain('CRED_PRESENT')   // it does see the tool's own output
  })

  it('denies an out-of-scope target and never spawns', async () => {
    const spy = vi.fn(nodeSpawn)
    const { events, emit } = collect()
    const scope: EngagementScope = { mode: 'allowlist', accounts: ['111111111111'], regions: [] }
    const result = await runSkill(
      { ...inv, account: '999999999999' }, probeSkill, emit,
      baseDeps({ getScope: () => scope, spawn: spy as any }),
    )
    expect(result.state).toBe('denied')
    expect(spy).not.toHaveBeenCalled()
    expect(events.some(e => e.type === 'skill' && e.state === 'denied')).toBe(true)
  })

  it('blocks and emits an input_request when a required env var is missing — never spawns', async () => {
    const spy = vi.fn(nodeSpawn)
    const { events, emit } = collect()
    const needsCred: SkillDef = { ...probeSkill, requiredEnvVars: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] }
    const result = await runSkill(inv, needsCred, emit, baseDeps({ filledEnvVars: () => [], spawn: spy as any }))

    expect(result.state).toBe('blocked')
    expect(spy).not.toHaveBeenCalled()
    const req = events.find(e => e.type === 'input_request') as any
    expect(req.items.map((i: any) => i.key)).toEqual(['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'])
    expect(req.items.every((i: any) => i.sensitive && i.required)).toBe(true)
  })

  it('runs when every required env var is filled', async () => {
    const { events, emit } = collect()
    const needsCred: SkillDef = { ...probeSkill, requiredEnvVars: ['AWS_SECRET_ACCESS_KEY'] }
    const result = await runSkill(inv, needsCred, emit, baseDeps())   // filledEnvVars has it
    expect(result.state).toBe('success')
    expect(events.some(e => e.type === 'input_request')).toBe(false)
  })

  it('blocks (and requests scope) when no scope record exists — the gate', async () => {
    const spy = vi.fn(nodeSpawn)
    const { events, emit } = collect()
    const result = await runSkill(inv, probeSkill, emit, baseDeps({ getScope: () => undefined, spawn: spy as any }))

    expect(result).toEqual({ state: 'blocked', reason: 'no-scope' })
    expect(spy).not.toHaveBeenCalled()
    expect(events.some(e => e.type === 'scope_request')).toBe(true)
  })
})

describe('cleanBaseEnv', () => {
  it('strips AWS_* from an inherited environment (no host-credential bleed)', () => {
    const cleaned = cleanBaseEnv({ PATH: '/usr/bin', AWS_ACCESS_KEY_ID: 'leak', AWS_PROFILE: 'x', HOME: '/home/u' })
    expect(cleaned).toEqual({ PATH: '/usr/bin', HOME: '/home/u' })
  })
  it('drops undefined values', () => {
    expect(cleanBaseEnv({ A: 'x', B: undefined })).toEqual({ A: 'x' })
  })
})
