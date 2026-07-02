import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'

describe('better-sqlite3 native module', () => {
  it('opens an in-memory db and round-trips a row', () => {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE t (k TEXT PRIMARY KEY, v TEXT)')
    db.prepare('INSERT INTO t (k, v) VALUES (?, ?)').run('a', '1')
    const row = db.prepare('SELECT v FROM t WHERE k = ?').get('a') as { v: string }
    expect(row.v).toBe('1')
    db.close()
  })
})
