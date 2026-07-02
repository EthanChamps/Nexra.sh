import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = { available: true }
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => state.available,
    // Reversible stand-in for the OS crypto: prefix-tag the bytes.
    encryptString: (s: string) => Buffer.from('enc:' + s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, ''),
  },
}))

import { encryptSecret, decryptSecret } from '../electron/services/secrets'

beforeEach(() => { state.available = true })

describe('secrets', () => {
  it('round-trips a secret via base64 ciphertext', () => {
    const blob = encryptSecret('sk-test-123')
    expect(blob).not.toContain('sk-test-123')          // not stored as plaintext
    expect(decryptSecret(blob)).toBe('sk-test-123')
  })
  it('throws (does not fall back to plaintext) when encryption is unavailable', () => {
    state.available = false
    expect(() => encryptSecret('sk-x')).toThrow(/unavailable/i)
  })
})
