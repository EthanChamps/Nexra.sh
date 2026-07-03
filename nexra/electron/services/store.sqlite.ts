import Database from 'better-sqlite3'
import type { Secret, SecretField, EngagementScope, Finding, Evidence, ScopeItem } from './store.types'

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
  // Additive migration (M3d): older DBs created the secrets table without it.
  // ALTER throws if the column already exists — swallow that one case only.
  try { db.exec('ALTER TABLE secrets ADD COLUMN sensitive INTEGER') } catch { /* column already present */ }
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
  // Project-level (company-shared) enforced scope. Flat authorized-target list.
  db.exec(`CREATE TABLE IF NOT EXISTS project_scope (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    source TEXT NOT NULL,
    added_at INTEGER NOT NULL
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

  // ── M4: engagement graph (companies → engagements → chats → messages) ──
  db.exec(`CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, updated TEXT NOT NULL, ord INTEGER NOT NULL
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS engagements (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL,
    status TEXT NOT NULL, updated TEXT NOT NULL, linear INTEGER NOT NULL,
    phases TEXT NOT NULL, scope TEXT NOT NULL, ord INTEGER NOT NULL
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY, engagement_id TEXT NOT NULL, name TEXT NOT NULL,
    phase_id TEXT NOT NULL, color TEXT NOT NULL, ord INTEGER NOT NULL
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, role TEXT NOT NULL, kind TEXT NOT NULL,
    content TEXT, tool_name TEXT, command TEXT, output TEXT, duration TEXT,
    reason TEXT, install_cmd TEXT, state TEXT,
    request_kind TEXT, request_id TEXT, items TEXT, engagement_id TEXT, ord INTEGER NOT NULL
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS phase_coverage (
    engagement_id TEXT NOT NULL, phase_id TEXT NOT NULL, status TEXT NOT NULL, updated TEXT NOT NULL,
    PRIMARY KEY (engagement_id, phase_id)
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS engagement_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT, engagement_id TEXT NOT NULL, chat_id TEXT,
    kind TEXT NOT NULL, content TEXT NOT NULL, time TEXT NOT NULL
  )`)
}

function requireDb(): Database.Database {
  if (!db) throw new Error('settings db not initialized — call initSettingsDb first')
  return db
}

// Shared handle for sibling persistence modules (store.graph.ts, coverage/memory).
export function getDb(): Database.Database {
  return requireDb()
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
interface SecretMetaRow { id: string; company_id: string; name: string; fields: string; status: string; alias_of: string | null; created_by: string; sensitive: number | null }

function rowToSecret(r: SecretMetaRow): Secret {
  return {
    id: r.id, companyId: r.company_id, name: r.name,
    fields: JSON.parse(r.fields) as SecretField[],
    status: r.status as Secret['status'],
    aliasOf: r.alias_of ?? undefined,
    createdBy: r.created_by as Secret['createdBy'],
    sensitive: r.sensitive == null ? undefined : r.sensitive === 1,
  }
}

export function insertSecretMeta(s: Secret): void {
  requireDb().prepare(
    `INSERT INTO secrets (id, company_id, name, fields, status, alias_of, created_by, sensitive)
     VALUES (@id, @company_id, @name, @fields, @status, @alias_of, @created_by, @sensitive)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, fields=excluded.fields, status=excluded.status,
       alias_of=excluded.alias_of, created_by=excluded.created_by, sensitive=excluded.sensitive`,
  ).run({
    id: s.id, company_id: s.companyId, name: s.name,
    fields: JSON.stringify(s.fields), status: s.status,
    alias_of: s.aliasOf ?? null, created_by: s.createdBy,
    sensitive: s.sensitive == null ? null : (s.sensitive ? 1 : 0),
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

// ── project scope (company-shared, enforced) ────────────────────────────────
interface ScopeItemRow { id: string; company_id: string; type: string; value: string; source: string; added_at: number }

export function insertScopeItem(companyId: string, item: ScopeItem): void {
  requireDb().prepare(
    `INSERT INTO project_scope (id, company_id, type, value, source, added_at)
     VALUES (@id, @company_id, @type, @value, @source, @added_at)
     ON CONFLICT(id) DO UPDATE SET type=excluded.type, value=excluded.value, source=excluded.source`,
  ).run({ id: item.id, company_id: companyId, type: item.type, value: item.value, source: item.source, added_at: item.addedAt })
}

export function deleteScopeItem(companyId: string, id: string): void {
  requireDb().prepare('DELETE FROM project_scope WHERE company_id = ? AND id = ?').run(companyId, id)
}

export function listScopeItems(companyId: string): ScopeItem[] {
  const rows = requireDb().prepare('SELECT * FROM project_scope WHERE company_id = ? ORDER BY added_at, rowid').all(companyId) as ScopeItemRow[]
  return rows.map(r => ({ id: r.id, type: r.type as ScopeItem['type'], value: r.value, source: r.source as ScopeItem['source'], addedAt: r.added_at }))
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

// Delete every finding for a chat and its evidence (used by M4 cascade deletes).
export function deleteFindingsByChat(chatId: string): void {
  const d = requireDb()
  const ids = (d.prepare('SELECT id FROM findings WHERE chat_id = ?').all(chatId) as { id: string }[]).map(r => r.id)
  const delEv = d.prepare('DELETE FROM evidence WHERE finding_id = ?')
  for (const id of ids) delEv.run(id)
  d.prepare('DELETE FROM findings WHERE chat_id = ?').run(chatId)
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
