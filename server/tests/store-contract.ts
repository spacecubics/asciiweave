import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DocumentStore } from '../src/persistence/store'

// Behavioral contract every DocumentStore implementation must satisfy.
// Runs against local node:sqlite (server/tests/persistence.test.ts) and
// against a real local D1 database in the Workers runtime
// (server/tests-workers/d1-store.test.ts). The database is created
// entirely from the shared migration series. Document IDs are
// randomized per test because the D1 harness shares one database across
// a test file — the contract must not assume a pristine store.
export function describeStoreContract(makeStore: () => Promise<DocumentStore> | DocumentStore) {
  describe('document store contract', () => {
    let store: DocumentStore

    const uid = (name: string) => `${name}-${crypto.randomUUID().slice(0, 8)}`

    beforeEach(async () => {
      store = await makeStore()
    })

    afterEach(() => {
      store.close()
    })

    it('has no record of a never-created document', async () => {
      const id = uid('never-created')
      expect(await store.get(id)).toBeUndefined()
      expect(await store.getYjsState(id)).toBeUndefined()
    })

    it('creates and reads back a document', async () => {
      const id = uid('doc')
      const created = await store.create(id, '= Hello\n')
      expect(created.id).toBe(id)
      expect(created.revision).toBe(1)
      const read = await store.get(id)
      expect(read?.source).toBe('= Hello\n')
      expect(read?.revision).toBe(1)
      expect(read?.created_at).toBe(created.created_at)
      expect(read?.updated_at).toBe(created.updated_at)
    })

    it('rejects a duplicate document id', async () => {
      const id = uid('dup')
      await store.create(id, 'one')
      await expect(store.create(id, 'two')).rejects.toThrow()
      expect((await store.get(id))?.source).toBe('one')
    })

    it('updates the source, bumping the revision, and reports missing documents', async () => {
      const id = uid('doc')
      await store.create(id, 'one')
      expect(await store.updateSource(id, 'two')).toBe(true)
      const doc = await store.get(id)
      expect(doc?.source).toBe('two')
      expect(doc?.revision).toBe(2)
      expect(await store.updateSource(id, 'three')).toBe(true)
      expect((await store.get(id))?.revision).toBe(3)
      expect(await store.updateSource(uid('missing'), 'x')).toBe(false)
    })

    it('rejects invalid input at the SQL boundary', async () => {
      // NOT NULL constraints hold in both engines; the error surfaces
      // as a rejection, never a silent write.
      const id = uid('bad')
      await expect(store.create(id, null as unknown as string)).rejects.toThrow()
      expect(await store.get(id)).toBeUndefined()
    })

    it('keeps documents isolated from each other', async () => {
      const a = uid('a')
      const b = uid('b')
      await store.create(a, 'doc a')
      await store.create(b, 'doc b')
      await store.updateSource(a, 'doc a edited')
      expect((await store.get(b))?.source).toBe('doc b')
      expect((await store.get(b))?.revision).toBe(1)
    })

    it('round-trips Yjs state blobs, overwriting on rewrite', async () => {
      const id = uid('yjs')
      expect(await store.getYjsState(id)).toBeUndefined()
      const state = new Uint8Array([1, 2, 3, 0, 255, 128])
      await store.setYjsState(id, state)
      expect(await store.getYjsState(id)).toEqual(state)

      const updated = new Uint8Array([9, 8, 7])
      await store.setYjsState(id, updated)
      expect(await store.getYjsState(id)).toEqual(updated)
    })

    it('round-trips Japanese and general Unicode exactly', async () => {
      const id = uid('jp')
      const source = '= 日本語のタイトル\n\nこんにちは、世界。🎉 café naïve — combining: がぎぐ゙\n'
      await store.create(id, source)
      expect((await store.get(id))?.source).toBe(source)

      const updated = source + '\n追加の行です。\n'
      await store.updateSource(id, updated)
      expect((await store.get(id))?.source).toBe(updated)
    })
  })
}
