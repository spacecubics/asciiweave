import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { seedRoom, writeRoomState } from '../src/collaboration/rooms'
import { openStore, type DocumentStore } from '../src/persistence/db'

describe('collaboration rooms', () => {
  let store: DocumentStore

  beforeEach(() => {
    store = openStore(':memory:')
  })

  afterEach(() => {
    store.close()
  })

  it('seeds a new room from the persisted source exactly once', () => {
    store.create('abc', '= Persisted\n')
    const ydoc = new Y.Doc()

    seedRoom(store, 'abc', ydoc)
    expect(ydoc.getText('source').toString()).toBe('= Persisted\n')

    // A second bind (e.g. after reconnect races) must not duplicate.
    seedRoom(store, 'abc', ydoc)
    expect(ydoc.getText('source').toString()).toBe('= Persisted\n')
  })

  it('leaves rooms for unknown documents empty', () => {
    const ydoc = new Y.Doc()
    seedRoom(store, 'missing', ydoc)
    expect(ydoc.getText('source').toString()).toBe('')
  })

  it('flushes room text back to the store when the room closes', () => {
    store.create('abc', 'old content')
    const ydoc = new Y.Doc()
    ydoc.getText('source').insert(0, 'collaborative result')

    writeRoomState(store, 'abc', ydoc)
    expect(store.get('abc')?.source).toBe('collaborative result')
  })

  it('ignores flushes for rooms without a document', () => {
    const ydoc = new Y.Doc()
    ydoc.getText('source').insert(0, 'stray')
    expect(() => writeRoomState(store, 'unknown', ydoc)).not.toThrow()
    expect(store.get('unknown')).toBeUndefined()
  })
})
