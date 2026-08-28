import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DocumentStore } from '../src/persistence/db'

// Behavioral contract every DocumentStore implementation must satisfy,
// so a second backend (the coming Cloudflare D1 store) can prove it
// behaves exactly like node:sqlite by running the same suite. The
// database is created entirely from the shared migration series.
// Document IDs are randomized per test because not every harness gives
// each test a pristine database; the contract must not assume one.
export function describeStoreContract(makeStore: () => DocumentStore) {
  describe('document store contract', () => {
    let store: DocumentStore

    const uid = (name: string) => `${name}-${crypto.randomUUID().slice(0, 8)}`

    beforeEach(() => {
      store = makeStore()
    })

    afterEach(() => {
      store.close()
    })

    it('has no record of a never-created document', () => {
      const id = uid('never-created')
      expect(store.get(id)).toBeUndefined()
      expect(store.getYjsState(id)).toBeUndefined()
    })

    it('creates and reads back a document', () => {
      const id = uid('doc')
      const created = store.create(id, '= Hello\n')
      expect(created.id).toBe(id)
      expect(created.revision).toBe(1)
      const read = store.get(id)
      expect(read?.source).toBe('= Hello\n')
      expect(read?.revision).toBe(1)
      expect(read?.created_at).toBe(created.created_at)
      expect(read?.updated_at).toBe(created.updated_at)
    })

    it('rejects a duplicate document id', () => {
      const id = uid('dup')
      store.create(id, 'one')
      expect(() => store.create(id, 'two')).toThrow()
      expect(store.get(id)?.source).toBe('one')
    })

    it('updates the source, bumping the revision, and reports missing documents', () => {
      const id = uid('doc')
      store.create(id, 'one')
      expect(store.updateSource(id, 'two')).toBe(true)
      const doc = store.get(id)
      expect(doc?.source).toBe('two')
      expect(doc?.revision).toBe(2)
      expect(store.updateSource(id, 'three')).toBe(true)
      expect(store.get(id)?.revision).toBe(3)
      expect(store.updateSource(uid('missing'), 'x')).toBe(false)
    })

    it('rejects invalid input at the SQL boundary', () => {
      // NOT NULL constraints hold; the error surfaces as a thrown
      // error, never a silent write.
      const id = uid('bad')
      expect(() => store.create(id, null as unknown as string)).toThrow()
      expect(store.get(id)).toBeUndefined()
    })

    it('keeps documents isolated from each other', () => {
      const a = uid('a')
      const b = uid('b')
      store.create(a, 'doc a')
      store.create(b, 'doc b')
      store.updateSource(a, 'doc a edited')
      expect(store.get(b)?.source).toBe('doc b')
      expect(store.get(b)?.revision).toBe(1)
    })

    it('round-trips Yjs state blobs, overwriting on rewrite', () => {
      const id = uid('yjs')
      expect(store.getYjsState(id)).toBeUndefined()
      const state = new Uint8Array([1, 2, 3, 0, 255, 128])
      store.setYjsState(id, state)
      expect(store.getYjsState(id)).toEqual(state)

      const updated = new Uint8Array([9, 8, 7])
      store.setYjsState(id, updated)
      expect(store.getYjsState(id)).toEqual(updated)
    })

    it('round-trips Japanese and general Unicode exactly', () => {
      const id = uid('jp')
      const source = '= 日本語のタイトル\n\nこんにちは、世界。🎉 café naïve — combining: がぎぐ゙\n'
      store.create(id, source)
      expect(store.get(id)?.source).toBe(source)

      const updated = source + '\n追加の行です。\n'
      store.updateSource(id, updated)
      expect(store.get(id)?.source).toBe(updated)
    })
  })
}
