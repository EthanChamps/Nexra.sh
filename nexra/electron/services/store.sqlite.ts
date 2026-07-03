import Database from 'better-sqlite3'
import type { Secret, SecretField, EngagementScope, Finding, Evidence } from './store.types'

let db: Database.Database | null = null

// Opens (creating if needed) the app DB and ensures the schema exists.
// Idempotent: safe to call again on an already-initialized path.
//
// M3a stood this up "for settings only"; M3b extends it to settings + secrets +
// scope (both config-like and must survive restart — engagement/message/finding
// persistence is still M4). New tables ride the same idempotent CREATE path.
export function initSettingsDb(dbPath: string): void {
  if (db) db.close()
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  // Credential slots — METADATA only (no value). Values live in secret_values.
  db.exec(`CREATE TABLE IF NOT EXISTS secrets (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    fields TEXT NOT NULL,
    status TEXT NOT NULL,
    alias_of TEXT,
    created_by TEXT NOT NULL
  )`)
  // Encrypted value blobs, one row per (secret, env var). Deliberately a
  // SEPARATE table so listing secret metadata can never accidentally SELECT a
  // ciphertext, let alone a plaintext.
  db.exec(`CREATE TABLE IF NOT EXISTS secret_values (
    secret_id TEXT NOT NULL,
    env_var TEXT NOT NULL,
    blob TEXT NOT NULL,
    PRIMARY KEY (secret_id, env_var)
  )`)
  // Typed, enforced engagement scope.
  db.exec(`CREATE TABLE IF NOT EXISTS scope (
    engagement_id TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    accounts TEXT NOT NULL,
    regions TEXT NOT NULL
  )`)
  // Findings + their evidence artifacts (M3c). Pulled forward from M4; chat_id
  // is a plain column now (companies/engagements/chats live in the mock
  // snapshot, not sqlite yet). M4 adds those parent tables + FKs — an additive
  // migration, not a rewrite.
  db.exec(`CREATE TABLE IF NOT EXISTS findings (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    title TEXT NOT NULL,
    sev TEXT NOT NULL,
    phase TEXT NOT NULL,
    time TEXT NOT NULL,
    rationale TEXT NOT NULL,
    verified INTEGER NOT NULL
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    finding_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    tool_call_id TEXT,
    excerpt TEXT,
    host TEXT,
    detail TEXT
  )`)
}

function requireDb(): Database.Database {
  if (!db) throw new Error('settings db not initialized — call initSettingsDb first')
  return db
}

// ── settings (M3a) ──────────────────────────────────────────────────────────
export function getSetting(key: string): string | undefined {
  const row = requireDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value
}

export function setSetting(key: string, value: string): void {
  requireDb().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

// ── secrets metadata (M3b) ──────────────────────────────────────────────────
interface SecretMetaRow { id: string; company_id: string; name: string; fields: string; status: string; alias_of: string | null; created_by: string }

function rowToSecret(r: SecretMetaRow): Secret {
  return {
    id: r.id, companyId: r.company_id, name: r.name,
    fields: JSON.parse(r.fields) as SecretField[],
    status: r.status as Secret['status'],
    aliasOf: r.alias_of ?? undefined,
    createdBy: r.created_by as Secret['createdBy'],
  }
}

export function insertSecretMeta(s: Secret): void {
  requireDb().prepare(
    `INSERT INTO secrets (id, company_id, name, fields, status, alias_of, created_by)
     VALUES (@id, @company_id, @name, @fields, @status, @alias_of, @created_by)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, fields=excluded.fields, status=excluded.status,
       alias_of=excluded.alias_of, created_by=excluded.created_by`,
  ).run({
    id: s.id, company_id: s.companyId, name: s.name,
    fields: JSON.stringify(s.fields), status: s.status,
    alias_of: s.aliasOf ?? null, created_by: s.createdBy,
  })
}

export function getSecretMeta(id: string): Secret | undefined {
  const r = requireDb().prepare('SELECT * FROM secrets WHERE id = ?').get(id) as SecretMetaRow | undefined
  return r ? rowToSecret(r) : undefined
}

export function listSecretMetaByCompany(companyId: string): Secret[] {
  const rows = requireDb().prepare('SELECT * FROM secrets WHERE company_id = ? ORDER BY name').all(companyId) as SecretMetaRow[]
  return rows.map(rowToSecret)
}

export function deleteSecretRow(id: string): void {
  const d = requireDb()
  d.prepare('DELETE FROM secret_values WHERE secret_id = ?').run(id)
  d.prepare('DELETE FROM secrets WHERE id = ?').run(id)
}

// ── secret values (encrypted blobs) ─────────────────────────────────────────
export function setSecretValue(secretId: string, envVar: string, blob: string): void {
  requireDb().prepare(
    `INSERT INTO secret_values (secret_id, env_var, blob) VALUES (?, ?, ?)
     ON CONFLICT(secret_id, env_var) DO UPDATE SET blob = excluded.blob`,
  ).run(secretId, envVar, blob)
}

export function getSecretValueBlob(secretId: string, envVar: string): string | undefined {
  const r = requireDb().prepare('SELECT blob FROM secret_values WHERE secret_id = ? AND env_var = ?').get(secretId, envVar) as { blob: string } | undefined
  return r?.blob
}

// ── scope (M3b) ─────────────────────────────────────────────────────────────
export function setScopeRow(engagementId: string, s: EngagementScope): void {
  requireDb().prepare(
    `INSERT INTO scope (engagement_id, mode, accounts, regions) VALUES (?, ?, ?, ?)
     ON CONFLICT(engagement_id) DO UPDATE SET mode=excluded.mode, accounts=excluded.accounts, regions=excluded.regions`,
  ).run(engagementId, s.mode, JSON.stringify(s.accounts), JSON.stringify(s.regions))
}

export function getScopeRow(engagementId: string): EngagementScope | undefined {
  const r = requireDb().prepare('SELECT mode, accounts, regions FROM scope WHERE engagement_id = ?').get(engagementId) as { mode: string; accounts: string; regions: string } | undefined
  if (!r) return undefined
  return { mode: r.mode as EngagementScope['mode'], accounts: JSON.parse(r.accounts), regions: JSON.parse(r.regions) }
}

// ── findings + evidence (M3c) ───────────────────────────────────────────────
interface FindingRow { id: string; chat_id: string; title: string; sev: string; phase: string; time: string; rationale: string; verified: number }
interface EvidenceRow { kind: string; tool_call_id: string | null; excerpt: string | null; host: string | null; detail: string | null }

function rowToEvidence(r: EvidenceRow): Evidence {
  if (r.kind === 'tool_output') return { kind: 'tool_output', toolCallId: r.tool_call_id ?? '', excerpt: r.excerpt ?? '' }
  if (r.kind === 'code_block') return { kind: 'code_block', host: r.host ?? '', detail: r.detail ?? '' }
  return { kind: 'image' }
}

// Insert-or-replace a finding and its evidence. Evidence rows are fully
// replaced so an upsert that changes evidence never leaves stale rows.
export function upsertFinding(chatId: string, f: Finding): void {
  const d = requireDb()
  d.prepare(
    `INSERT INTO findings (id, chat_id, title, sev, phase, time, rationale, verified)
     VALUES (@id, @chat_id, @title, @sev, @phase, @time, @rationale, @verified)
     ON CONFLICT(id) DO UPDATE SET
       chat_id=excluded.chat_id, title=excluded.title, sev=excluded.sev,
       phase=excluded.phase, time=excluded.time, rationale=excluded.rationale,
       verified=excluded.verified`,
  ).run({ id: f.id, chat_id: chatId, title: f.title, sev: f.sev, phase: f.phase, time: f.time, rationale: f.rationale, verified: f.verified ? 1 : 0 })
  d.prepare('DELETE FROM evidence WHERE finding_id = ?').run(f.id)
  const ins = d.prepare('INSERT INTO evidence (finding_id, kind, tool_call_id, excerpt, host, detail) VALUES (?, ?, ?, ?, ?, ?)')
  for (const ev of f.evidence) {
    if (ev.kind === 'tool_output') ins.run(f.id, ev.kind, ev.toolCallId, ev.excerpt, null, null)
    else if (ev.kind === 'code_block') ins.run(f.id, ev.kind, null, null, ev.host, ev.detail)
    else ins.run(f.id, ev.kind, null, null, null, null)
  }
}

export function listFindingsByChat(chatId: string): Finding[] {
  const d = requireDb()
  const rows = d.prepare('SELECT * FROM findings WHERE chat_id = ? ORDER BY rowid').all(chatId) as FindingRow[]
  const evStmt = d.prepare('SELECT kind, tool_call_id, excerpt, host, detail FROM evidence WHERE finding_id = ? ORDER BY id')
  return rows.map(r => ({
    id: r.id, title: r.title, sev: r.sev as Finding['sev'], phase: r.phase, time: r.time,
    rationale: r.rationale, verified: !!r.verified,
    evidence: (evStmt.all(r.id) as EvidenceRow[]).map(rowToEvidence),
  }))
}
