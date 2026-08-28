import type { D1Database } from '@cloudflare/workers-types'
import type { DocumentRecord, DocumentStore } from './store'

// D1 implementation of the storage boundary. Schema comes from the same
// migrations/ series as local SQLite, applied by Wrangler
// (`wrangler d1 migrations apply DB`). This module must stay free of
// node: imports — it is bundled into the Worker.

// D1 returns BLOB columns as ArrayBuffer and accepts ArrayBuffer (or a
// plain number array) as a bound parameter, never a typed-array view.
function toArrayBuffer(state: Uint8Array): ArrayBuffer {
  // slice() copies, so the buffer has exactly the view's bytes.
  return state.slice().buffer as ArrayBuffer
}

function toUint8Array(state: ArrayBuffer | number[]): Uint8Array {
  return Array.isArray(state) ? Uint8Array.from(state) : new Uint8Array(state)
}

export function createD1Store(db: D1Database): DocumentStore {
  return {
    async create(id, source) {
      const now = new Date().toISOString()
      await db
        .prepare(
          'INSERT INTO documents (id, source, revision, created_at, updated_at) VALUES (?, ?, 1, ?, ?)',
        )
        .bind(id, source, now, now)
        .run()
      return { id, source, revision: 1, created_at: now, updated_at: now }
    },
    async get(id) {
      const row = await db
        .prepare('SELECT id, source, revision, created_at, updated_at FROM documents WHERE id = ?')
        .bind(id)
        .first<DocumentRecord>()
      return row ?? undefined
    },
    async updateSource(id, source) {
      const result = await db
        .prepare(
          'UPDATE documents SET source = ?, revision = revision + 1, updated_at = ? WHERE id = ?',
        )
        .bind(source, new Date().toISOString(), id)
        .run()
      return result.meta.changes === 1
    },
    async getYjsState(id) {
      const row = await db
        .prepare('SELECT state FROM yjs_state WHERE id = ?')
        .bind(id)
        .first<{ state: ArrayBuffer | number[] }>()
      return row ? toUint8Array(row.state) : undefined
    },
    async setYjsState(id, state) {
      await db
        .prepare(
          `INSERT INTO yjs_state (id, state, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
        )
        .bind(id, toArrayBuffer(state), new Date().toISOString())
        .run()
    },
    close() {
      // D1 connections have no close; the binding is managed by the runtime.
    },
  }
}
