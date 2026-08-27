import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import type * as YTypes from 'yjs'
import { bindRoomState, persistRoom } from '../src/collaboration/rooms'
import { openStore, type DocumentStore } from '../src/persistence/db'

const Y = createRequire(import.meta.url)('yjs') as typeof YTypes

function restoredText(store: DocumentStore, id: string): string {
  const room = new Y.Doc()
  bindRoomState(store, id, room)
  const text = room.getText('source').toString()
  room.destroy()
  return text
}

describe('durable Yjs persistence, deeply', () => {
  it('a corrupt state blob falls back to plain source and heals on next persist', () => {
    const store = openStore(':memory:')
    store.create('doc', '= Recoverable\n')
    store.setYjsState('doc', new Uint8Array([255, 254, 253, 1, 2, 3]))

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const room = new Y.Doc()
      expect(() => bindRoomState(store, 'doc', room)).not.toThrow()
      expect(room.getText('source').toString()).toBe('= Recoverable\n')

      // The next persist overwrites the corrupt blob with a healthy one.
      persistRoom(store, 'doc', room)
      expect(restoredText(store, 'doc')).toBe('= Recoverable\n')
    } finally {
      errors.mockRestore()
    }
    store.close()
  })

  it('a failing store cannot crash the debounced persist timer', () => {
    vi.useFakeTimers()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const store = openStore(':memory:')
      store.create('doc', '')
      const failing: DocumentStore = {
        ...store,
        setYjsState: () => {
          throw new Error('disk full')
        },
      }
      const room = new Y.Doc()
      bindRoomState(failing, 'doc', room, 100)
      room.getText('source').insert(0, 'edit')
      expect(() => vi.advanceTimersByTime(500)).not.toThrow()
      expect(errors).toHaveBeenCalled()
      store.close()
    } finally {
      errors.mockRestore()
      vi.useRealTimers()
    }
  })

  it('a truncated healthy blob cannot crash the restore path', () => {
    const store = openStore(':memory:')
    store.create('doc', '= Fallback\n')
    const healthy = new Y.Doc()
    healthy.getText('source').insert(0, 'complete state')
    const full = Y.encodeStateAsUpdate(healthy)

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      for (const cut of [1, 3, Math.floor(full.length / 2), full.length - 1]) {
        store.setYjsState('doc', full.slice(0, cut))
        const room = new Y.Doc()
        expect(() => bindRoomState(store, 'doc', room), `truncated at ${cut}`).not.toThrow()
        const text = room.getText('source').toString()
        // Whatever survives decoding, the room must be usable: either
        // the fallback text or a consistent partial state.
        expect(typeof text).toBe('string')
        room.getText('source').insert(0, 'still editable ')
        room.destroy()
      }
    } finally {
      errors.mockRestore()
    }
    store.close()
  })
})
