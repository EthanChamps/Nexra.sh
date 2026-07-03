import { randomUUID } from 'node:crypto'
import { encryptSecret, decryptSecret } from './secrets'
import {
  insertSecretMeta, getSecretMeta, listSecretMetaByCompany, deleteSecretRow,
  setSecretValue, getSecretValueBlob,
} from './store.sqlite'
import type { Secret, SecretField } from './store.types'

// Per-project credential vault. This module is the ONLY place plaintext
// credential values are handled, and only ever in the main process:
//   - create/fill: plaintext arrives from the renderer once, is encrypted with
//     the OS keychain (safeStorage, via ./secrets), and stored as ciphertext.
//   - injectEnv: ciphertext is decrypted into an env map at child-spawn time.
// No renderer-facing surface (list*) ever returns a value — only metadata.

export interface CreateSecretInput {
  companyId: string
  name: string
  fields: SecretField[]
  createdBy: Secret['createdBy']
}

// Create an empty PENDING slot (authored by operator now, or by the agent in
// M3b-2). The consultant fills it, or ties it to an existing secret, later.
export function createSecret(input: CreateSecretInput): Secret {
  const secret: Secret = {
    id: randomUUID(),
    companyId: input.companyId,
    name: input.name,
    fields: input.fields,
    status: 'pending',
    createdBy: input.createdBy,
  }
  insertSecretMeta(secret)
  return secret
}

// Fill a slot's values. `values` maps each declared env var to its plaintext;
// every declared field must be supplied. Encrypts each and flips to `filled`.
export function fillSecret(id: string, values: Record<string, string>): Secret {
  const meta = getSecretMeta(id)
  if (!meta) throw new Error('unknown secret: ' + id)
  for (const f of meta.fields) {
    const v = values[f.envVar]
    if (v == null || v === '') throw new Error('missing value for field: ' + f.envVar)
    setSecretValue(id, f.envVar, encryptSecret(v))
  }
  const filled: Secret = { ...meta, status: 'filled', aliasOf: undefined }
  insertSecretMeta(filled)
  return filled
}

// Tie a slot to an already-filled secret: no own values, resolves to the
// target's values at injection time. Flips to `filled`.
export function tieSecret(id: string, aliasOf: string): Secret {
  const meta = getSecretMeta(id)
  if (!meta) throw new Error('unknown secret: ' + id)
  const target = getSecretMeta(aliasOf)
  if (!target) throw new Error('unknown alias target: ' + aliasOf)
  const tied: Secret = { ...meta, status: 'filled', aliasOf }
  insertSecretMeta(tied)
  return tied
}

// Metadata only — safe for the renderer/agent. Never carries a value.
export function listSecrets(companyId: string): Secret[] {
  return listSecretMetaByCompany(companyId)
}

export function deleteSecret(id: string): void {
  deleteSecretRow(id)
}

// True iff a company has a FILLED secret by that reference name — used to
// decide whether a skill can run or must emit a secret_request.
export function hasFilledSecret(companyId: string, name: string): boolean {
  return listSecretMetaByCompany(companyId).some(s => s.name === name && s.status === 'filled')
}

// Decrypt every FILLED secret for a company into an env map. Aliases resolve to
// their target's fields+values. Called ONLY in main, ONLY at child spawn. Later
// env vars win on collision (documented; operators avoid clashing names).
export function injectEnv(companyId: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const s of listSecretMetaByCompany(companyId)) {
    if (s.status !== 'filled') continue
    const source = s.aliasOf ? getSecretMeta(s.aliasOf) : s
    if (!source) continue
    for (const f of source.fields) {
      const blob = getSecretValueBlob(source.id, f.envVar)
      if (blob != null) env[f.envVar] = source.sensitive === false ? blob : decryptSecret(blob)
    }
  }
  return env
}

// Every env-var name across a company's FILLED secrets, WITHOUT decrypting any
// value. Used by the skill hard-gate (M3d) to decide, by field presence rather
// than by a fixed secret name, whether a scan may run.
export function filledEnvVars(companyId: string): string[] {
  const out: string[] = []
  for (const s of listSecretMetaByCompany(companyId)) {
    if (s.status !== 'filled') continue
    const source = s.aliasOf ? getSecretMeta(s.aliasOf) : s
    if (!source) continue
    for (const f of source.fields) out.push(f.envVar)
  }
  return out
}

// Create-or-update a single-field secret named `key` and fill it in one step
// (the agent-requested-input path). Sensitive values are encrypted; non-secret
// config values are stored in the clear. Idempotent per (companyId, key).
export function upsertFilledInput(companyId: string, key: string, value: string, sensitive: boolean): Secret {
  const existing = listSecretMetaByCompany(companyId).find(s => s.name === key)
  const id = existing?.id ?? randomUUID()
  const secret: Secret = {
    id, companyId, name: key, fields: [{ envVar: key }],
    status: 'filled', createdBy: existing?.createdBy ?? 'agent', sensitive,
  }
  insertSecretMeta(secret)
  setSecretValue(id, key, sensitive ? encryptSecret(value) : value)
  return secret
}
