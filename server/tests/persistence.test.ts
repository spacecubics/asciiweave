import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyMigrations,
  migrationStatus,
  openDatabase,
  openStore,
  type DocumentStore,
} from '../src/persistence/db'

describe('document store', () => {
  let dir: string
  let store: DocumentStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'asciiweave-test-'))
    store = openStore(join(dir, 'test.db'))
  })

  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates and reads back a document', () => {
    store.create('abc', '= Hello\n')
    expect(store.get('abc')?.source).toBe('= Hello\n')
    expect(store.get('abc')?.revision).toBe(1)
  })

  it('returns undefined for unknown ids', () => {
    expect(store.get('nope')).toBeUndefined()
  })

  it('updates the source, bumping the revision, and reports missing documents', () => {
    store.create('abc', 'one')
    expect(store.updateSource('abc', 'two')).toBe(true)
    expect(store.get('abc')?.source).toBe('two')
    expect(store.get('abc')?.revision).toBe(2)
    expect(store.updateSource('missing', 'x')).toBe(false)
  })

  it('keeps documents isolated from each other', () => {
    store.create('a', 'doc a')
    store.create('b', 'doc b')
    store.updateSource('a', 'doc a edited')
    expect(store.get('b')?.source).toBe('doc b')
    expect(store.get('b')?.revision).toBe(1)
  })

  it('survives a close and reopen (server restart)', () => {
    const path = join(dir, 'restart.db')
    const first = openStore(path)
    first.create('abc', '= Persisted\n')
    first.updateSource('abc', '= Persisted v2\n')
    first.close()

    const second = openStore(path)
    expect(second.get('abc')?.source).toBe('= Persisted v2\n')
    expect(second.get('abc')?.revision).toBe(2)
    second.close()
  })

  it('round-trips Yjs state blobs and survives a reopen', () => {
    const path = join(dir, 'yjs.db')
    const first = openStore(path)
    expect(first.getYjsState('abc')).toBeUndefined()
    const state = new Uint8Array([1, 2, 3, 0, 255, 128])
    first.setYjsState('abc', state)
    expect(first.getYjsState('abc')).toEqual(state)

    // Overwrites replace, and blobs survive a close/reopen (restart).
    const updated = new Uint8Array([9, 8, 7])
    first.setYjsState('abc', updated)
    first.close()
    const second = openStore(path)
    expect(second.getYjsState('abc')).toEqual(updated)
    second.close()
  })

  it('round-trips Japanese and general Unicode exactly', () => {
    const source = '= 日本語のタイトル\n\nこんにちは、世界。🎉 café naïve — combining: がぎぐ゙\n'
    store.create('jp', source)
    expect(store.get('jp')?.source).toBe(source)

    const updated = source + '\n追加の行です。\n'
    store.updateSource('jp', updated)
    expect(store.get('jp')?.source).toBe(updated)
  })
})

describe('migrations', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'asciiweave-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates a fresh database entirely from migrations', () => {
    const db = openDatabase(join(dir, 'fresh.db'))
    const applied = applyMigrations(db)
    expect(applied).toEqual(['0001_initial_schema.sql'])

    const status = migrationStatus(db)
    expect(status.applied).toEqual(['0001_initial_schema.sql'])
    expect(status.pending).toEqual([])

    // Applying again is a no-op, not an error.
    expect(applyMigrations(db)).toEqual([])
    db.close()
  })

  it('reports pending migrations for an unmigrated database', () => {
    const db = openDatabase(join(dir, 'unmigrated.db'))
    const status = migrationStatus(db)
    expect(status.applied).toEqual([])
    expect(status.pending).toContain('0001_initial_schema.sql')
    db.close()
  })

  it('adopts a pre-migration legacy database without losing data', () => {
    // Databases from before the migration series: created with
    // CREATE TABLE IF NOT EXISTS at startup, no revision column, no
    // migration tracking.
    const path = join(dir, 'legacy.db')
    const legacy = new DatabaseSync(path)
    legacy.exec(`
      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE yjs_state (
        id TEXT PRIMARY KEY,
        state BLOB NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
    legacy
      .prepare('INSERT INTO documents (id, source, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('old-doc', '= Legacy\n', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    legacy.close()

    const store = openStore(path)
    const doc = store.get('old-doc')
    expect(doc?.source).toBe('= Legacy\n')
    expect(doc?.revision).toBe(1)
    expect(store.updateSource('old-doc', '= Legacy v2\n')).toBe(true)
    expect(store.get('old-doc')?.revision).toBe(2)
    store.close()

    const db = openDatabase(path)
    expect(migrationStatus(db).pending).toEqual([])
    db.close()
  })
})
