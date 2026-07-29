import { describe, it, expect } from 'vitest'
import { modelTransportWarning } from '../electron/services/providers'

describe('modelTransportWarning — flag cleartext prompts to a remote model', () => {
  it('warns on http to a non-loopback host (pentest data would cross the LAN in cleartext)', () => {
    const w = modelTransportWarning({ provider: 'ollama', model: 'gemma3:27b', baseUrl: 'http://192.168.1.50:11434' })
    expect(w).toMatch(/cleartext|https|tunnel/i)
  })

  it('is silent for loopback http (local or via a tunnel that terminates on localhost)', () => {
    expect(modelTransportWarning({ provider: 'ollama', model: 'g', baseUrl: 'http://localhost:11434' })).toBeNull()
    expect(modelTransportWarning({ provider: 'ollama', model: 'g', baseUrl: 'http://127.0.0.1:11434' })).toBeNull()
  })

  it('is silent for https to a remote host', () => {
    expect(modelTransportWarning({ provider: 'ollama', model: 'g', baseUrl: 'https://mini.lan:11434' })).toBeNull()
  })

  it('is silent for the cloud provider (keyed, TLS by construction)', () => {
    expect(modelTransportWarning({ provider: 'anthropic', model: 'claude', apiKey: 'x' })).toBeNull()
  })
})
