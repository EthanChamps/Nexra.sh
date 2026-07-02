import Database from 'better-sqlite3'

let db: Database.Database | null = null

// Opens (creating if needed) the settings DB and ensures the schema exists.
// Idempotent: safe to call again on an already-initialized path.
export function initSettingsDb(dbPath: string): void {
  if (db) db.close()
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
}

function requireDb(): Database.Database {
  if (!db) throw new Error('settings db not initialized — call initSettingsDb first')
  return db
}

export function getSetting(key: string): string | undefined {
  const row = requireDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value
}

export function setSetting(key: string, value: string): void {
  requireDb().prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}
