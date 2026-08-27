import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// node:sqlite is still marked experimental; keep all direct usage inside
// this module so the driver can be swapped without touching callers.

export interface DocumentRecord {
  id: string
  source: string
  created_at: string
  updated_at: string
}

export interface DocumentStore {
  create(id: string, source: string): DocumentRecord
  get(id: string): DocumentRecord | undefined
  updateSource(id: string, source: string): boolean
  // Canonical Yjs collaborative state, stored as an opaque encoded
  // update. Plain AsciiDoc text is a user-facing representation, not a
  // replacement for this.
  getYjsState(id: string): Uint8Array | undefined
  setYjsState(id: string, state: Uint8Array): void
  close(): void
}

export function openStore(path: string): DocumentStore {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS yjs_state (
      id TEXT PRIMARY KEY,
      state BLOB NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  const insert = db.prepare(
    'INSERT INTO documents (id, source, created_at, updated_at) VALUES (?, ?, ?, ?)',
  )
  const select = db.prepare('SELECT id, source, created_at, updated_at FROM documents WHERE id = ?')
  const update = db.prepare('UPDATE documents SET source = ?, updated_at = ? WHERE id = ?')
  const selectY = db.prepare('SELECT state FROM yjs_state WHERE id = ?')
  const upsertY = db.prepare(`
    INSERT INTO yjs_state (id, state, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at
  `)

  return {
    create(id, source) {
      const now = new Date().toISOString()
      insert.run(id, source, now, now)
      return { id, source, created_at: now, updated_at: now }
    },
    get(id) {
      return select.get(id) as DocumentRecord | undefined
    },
    updateSource(id, source) {
      const now = new Date().toISOString()
      return update.run(source, now, id).changes === 1
    },
    getYjsState(id) {
      const row = selectY.get(id) as { state: Uint8Array } | undefined
      return row?.state
    },
    setYjsState(id, state) {
      upsertY.run(id, state, new Date().toISOString())
    },
    close() {
      db.close()
    },
  }
}
