import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as YTypes from 'yjs'
import { bindRoomState, persistRoom, seedRoom } from '../src/collaboration/rooms'
import { openStore } from '../src/persistence/sqlite'
import type { DocumentStore } from '../src/persistence/store'

// Use the same CJS yjs module instance as the room code (see rooms.ts):
// documents must never mix structs from the ESM and CJS builds.
const Y = createRequire(import.meta.url)('yjs') as typeof YTypes

describe('collaboration rooms', () => {
  let store: DocumentStore

  beforeEach(() => {
    store = openStore(':memory:')
  })

  afterEach(() => {
    store.close()
  })

  it('seeds a new room from the persisted source exactly once', async () => {
    await store.create('abc', '= Persisted\n')
    const ydoc = new Y.Doc()

    await seedRoom(store, 'abc', ydoc)
    expect(ydoc.getText('source').toString()).toBe('= Persisted\n')

    // A second bind (e.g. after reconnect races) must not duplicate.
    await seedRoom(store, 'abc', ydoc)
    expect(ydoc.getText('source').toString()).toBe('= Persisted\n')
  })

  it('leaves rooms for unknown documents empty', async () => {
    const ydoc = new Y.Doc()
    await seedRoom(store, 'missing', ydoc)
    expect(ydoc.getText('source').toString()).toBe('')
  })

  it('persists CRDT state and plain text together', async () => {
    await store.create('abc', 'old content')
    const ydoc = new Y.Doc()
    ydoc.getText('source').insert(0, 'collaborative result')

    await persistRoom(store, 'abc', ydoc)
    expect((await store.get('abc'))?.source).toBe('collaborative result')

    const restored = new Y.Doc()
    Y.applyUpdate(restored, (await store.getYjsState('abc'))!)
    expect(restored.getText('source').toString()).toBe('collaborative result')
  })

  it('never persists rooms without a document', async () => {
    const ydoc = new Y.Doc()
    ydoc.getText('source').insert(0, 'stray')
    await expect(persistRoom(store, 'unknown', ydoc)).resolves.toBeUndefined()
    expect(await store.get('unknown')).toBeUndefined()
    expect(await store.getYjsState('unknown')).toBeUndefined()
  })

  it('restores a room from durable CRDT state, which wins over plain text', async () => {
    await store.create('abc', 'stale plain text')
    const original = new Y.Doc()
    original.getText('source').insert(0, 'crdt content')
    await store.setYjsState('abc', Y.encodeStateAsUpdate(original))

    const room = new Y.Doc()
    await bindRoomState(store, 'abc', room)
    expect(room.getText('source').toString()).toBe('crdt content')
  })

  it('falls back to plain-text seeding for documents without CRDT state', async () => {
    await store.create('abc', '= Legacy Document\n')
    const room = new Y.Doc()
    await bindRoomState(store, 'abc', room)
    expect(room.getText('source').toString()).toBe('= Legacy Document\n')
  })

  it('re-persists the room state on every update, debounced', async () => {
    vi.useFakeTimers()
    try {
      await store.create('abc', '')
      const room = new Y.Doc()
      await bindRoomState(store, 'abc', room, 1000)

      room.getText('source').insert(0, 'first ')
      room.getText('source').insert(6, 'second')
      expect(await store.getYjsState('abc')).toBeUndefined()

      await vi.advanceTimersByTimeAsync(1000)
      const restored = new Y.Doc()
      Y.applyUpdate(restored, (await store.getYjsState('abc'))!)
      expect(restored.getText('source').toString()).toBe('first second')

      // Destroying the room (last client left) cancels the pending timer.
      room.getText('source').insert(0, 'late ')
      room.destroy()
      await vi.advanceTimersByTimeAsync(5000)
      const after = new Y.Doc()
      Y.applyUpdate(after, (await store.getYjsState('abc'))!)
      expect(after.getText('source').toString()).toBe('first second')
    } finally {
      vi.useRealTimers()
    }
  })

  it('round-trips concurrent edit history through persistence', async () => {
    // Two peers diverge, merge, and the merged CRDT state survives a
    // persist/restore cycle byte-exactly.
    await store.create('abc', '')
    const peerA = new Y.Doc()
    peerA.getText('source').insert(0, 'shared base')
    const peerB = new Y.Doc()
    Y.applyUpdate(peerB, Y.encodeStateAsUpdate(peerA))
    peerA.getText('source').insert(0, '[A] ')
    peerB.getText('source').insert(peerB.getText('source').length, ' [B]')
    Y.applyUpdate(peerA, Y.encodeStateAsUpdate(peerB))
    Y.applyUpdate(peerB, Y.encodeStateAsUpdate(peerA))
    const merged = peerA.getText('source').toString()

    await persistRoom(store, 'abc', peerA)
    const room = new Y.Doc()
    await bindRoomState(store, 'abc', room)
    expect(room.getText('source').toString()).toBe(merged)
  })
})
