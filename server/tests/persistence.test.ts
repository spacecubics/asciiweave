import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openStore, type DocumentStore } from '../src/persistence/db'

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
  })

  it('returns undefined for unknown ids', () => {
    expect(store.get('nope')).toBeUndefined()
  })

  it('updates the source and reports missing documents', () => {
    store.create('abc', 'one')
    expect(store.updateSource('abc', 'two')).toBe(true)
    expect(store.get('abc')?.source).toBe('two')
    expect(store.updateSource('missing', 'x')).toBe(false)
  })

  it('keeps documents isolated from each other', () => {
    store.create('a', 'doc a')
    store.create('b', 'doc b')
    store.updateSource('a', 'doc a edited')
    expect(store.get('b')?.source).toBe('doc b')
  })

  it('survives a close and reopen (server restart)', () => {
    const path = join(dir, 'restart.db')
    const first = openStore(path)
    first.create('abc', '= Persisted\n')
    first.updateSource('abc', '= Persisted v2\n')
    first.close()

    const second = openStore(path)
    expect(second.get('abc')?.source).toBe('= Persisted v2\n')
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
