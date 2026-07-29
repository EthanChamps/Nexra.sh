import { describe, it, expect, vi, afterEach } from 'vitest'

// testConnection backs the Settings "Test connection" button. For ollama it hits
// /api/tags (cheap, and also confirms the chosen model is actually installed —
// the split-compute setup fails silently otherwise). For cloud providers a
// 1-token generation proves the key end to end.

const generateText = vi.fn(async (..._a: any[]) => ({ text: 'x' }))
vi.mock('ai', () => ({ generateText: (...a: any[]) => generateText(...a) }))

import { testConnection } from '../electron/services/providers'

describe('testConnection', () => {
  const realFetch = global.fetch
  afterEach(() => { global.fetch = realFetch; generateText.mockReset() })

  it('ollama: ok when reachable and the model is installed', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ models: [{ name: 'qwen3.5:9b' }] }) })) as any
    const r = await testConnection({ provider: 'ollama', model: 'qwen3.5:9b', baseUrl: 'http://localhost:11434' })
    expect(r.ok).toBe(true)
  })

  it('ollama: not-ok when the model is missing, and lists what is available', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ models: [{ name: 'llama3.3' }] }) })) as any
    const r = await testConnection({ provider: 'ollama', model: 'qwen3.5:9b', baseUrl: 'http://localhost:11434' })
    expect(r.ok).toBe(false)
    expect(r.detail).toMatch(/not installed/)
    expect(r.detail).toMatch(/llama3\.3/)
  })

  it('ollama: not-ok when the host is unreachable', async () => {
    global.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED') }) as any
    const r = await testConnection({ provider: 'ollama', model: 'qwen3.5:9b', baseUrl: 'http://mini:11434' })
    expect(r.ok).toBe(false)
    expect(r.detail).toMatch(/Cannot reach/)
  })

  it('cloud: ok when a minimal generation succeeds', async () => {
    generateText.mockResolvedValueOnce({ text: 'ok' })
    const r = await testConnection({ provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'sk-x' })
    expect(r.ok).toBe(true)
    expect(generateText).toHaveBeenCalled()
  })

  it('cloud: not-ok surfaces the provider error (missing key)', async () => {
    const r = await testConnection({ provider: 'anthropic', model: 'claude-opus-4-8' })
    expect(r.ok).toBe(false)
    expect(r.detail).toMatch(/API key/i)
  })
})
