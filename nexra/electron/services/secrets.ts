import { safeStorage } from 'electron'

// Encrypts a secret with the OS keychain-backed key and returns base64
// ciphertext for storage. Refuses to operate (rather than store plaintext)
// when the platform has no secure storage available.
export function encryptSecret(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS secure storage is unavailable — cannot store secret')
  return safeStorage.encryptString(plain).toString('base64')
}

export function decryptSecret(b64: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS secure storage is unavailable — cannot read secret')
  return safeStorage.decryptString(Buffer.from(b64, 'base64'))
}
