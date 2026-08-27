import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import type * as YTypes from 'yjs'
import { bindRoomState, persistRoom } from '../src/collaboration/rooms'
import { openStore, type DocumentStore } from '../src/persistence/db'

const Y = createRequire(import.meta.url)('yjs') as typeof YTypes

// Deterministic PRNG so any fuzz failure is reproducible from its seed.
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FRAGMENTS = [
  'plain ascii ',
  '= Heading\n',
  '日本語テキスト',
  '🌸🎉👨‍👩‍👧‍👦', // emoji incl. ZWJ sequence
  'éä', // combining accents
  '𝕬𝖘𝖈𝖎𝖎', // astral-plane letters (surrogate pairs)
  '\n\n== 節\n\n',
  'ライン', // katakana
]

function randomEdit(random: () => number, ytext: YTypes.Text): void {
  const len = ytext.length
  if (len > 0 && random() < 0.35) {
    const start = Math.floor(random() * len)
    const delLen = Math.min(len - start, 1 + Math.floor(random() * 20))
    ytext.delete(start, delLen)
  } else {
    const pos = Math.floor(random() * (len + 1))
    ytext.insert(pos, FRAGMENTS[Math.floor(random() * FRAGMENTS.length)] as string)
  }
}

function restoredText(store: DocumentStore, id: string): string {
  const room = new Y.Doc()
  bindRoomState(store, id, room)
  const text = room.getText('source').toString()
  room.destroy()
  return text
}

describe('durable Yjs persistence, deeply', () => {
  it('fuzz: persist/restore stays lossless across hundreds of random edits', () => {
    for (const seed of [1, 42, 20260827]) {
      const random = mulberry32(seed)
      const store = openStore(':memory:')
      store.create('doc', '')
      const live = new Y.Doc()
      const ytext = live.getText('source')

      for (let op = 0; op < 300; op++) {
        randomEdit(random, ytext)
        if (op % 25 === 24) {
          persistRoom(store, 'doc', live)
          expect(restoredText(store, 'doc'), `seed ${seed}, op ${op}`).toBe(ytext.toString())
        }
      }
      store.close()
    }
  })

  it('fuzz: restore chains (restore of a restore) never drift', () => {
    const random = mulberry32(7)
    const store = openStore(':memory:')
    store.create('doc', '')
    let current = new Y.Doc()
    current.getText('source').insert(0, 'generation 0 ')

    // Each generation: persist, restore into a fresh doc, edit the
    // restored doc, repeat. Catches state that decays through cycles.
    for (let generation = 1; generation <= 20; generation++) {
      persistRoom(store, 'doc', current)
      const next = new Y.Doc()
      bindRoomState(store, 'doc', next)
      expect(next.getText('source').toString()).toBe(current.getText('source').toString())
      current.destroy()
      current = next
      for (let i = 0; i < 5; i++) {
        randomEdit(random, current.getText('source'))
      }
    }
    store.close()
  })

  it('fuzz: multi-peer divergence with mid-flight persistence converges', () => {
    for (const seed of [3, 99]) {
      const random = mulberry32(seed)
      const store = openStore(':memory:')
      store.create('doc', '')
      const room = new Y.Doc()
      bindRoomState(store, 'doc', room, 1e9)
      const peers = [room, new Y.Doc(), new Y.Doc()]

      const syncPair = (a: YTypes.Doc, b: YTypes.Doc) => {
        Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)))
        Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)))
      }

      for (let round = 0; round < 40; round++) {
        const peer = peers[Math.floor(random() * peers.length)] as YTypes.Doc
        randomEdit(random, peer.getText('source'))
        if (random() < 0.4) {
          syncPair(
            peers[Math.floor(random() * peers.length)] as YTypes.Doc,
            peers[Math.floor(random() * peers.length)] as YTypes.Doc,
          )
        }
        if (random() < 0.2) {
          persistRoom(store, 'doc', room) // snapshot mid-divergence
        }
      }
      // Full mesh sync, then the persisted room must equal everyone.
      for (const a of peers) for (const b of peers) syncPair(a, b)
      persistRoom(store, 'doc', room)
      const final = room.getText('source').toString()
      for (const peer of peers) {
        expect(peer.getText('source').toString()).toBe(final)
      }
      expect(restoredText(store, 'doc')).toBe(final)
      store.close()
    }
  })

  it('an intentionally emptied document stays empty — no legacy resurrection', () => {
    const store = openStore(':memory:')
    store.create('doc', '= Old Content That Was Deleted\n')
    const room = new Y.Doc()
    bindRoomState(store, 'doc', room) // seeds from legacy text
    room.getText('source').delete(0, room.getText('source').length)
    persistRoom(store, 'doc', room)

    // The persisted empty CRDT state must win over the (stale) text row.
    expect(restoredText(store, 'doc')).toBe('')
    store.close()
  })

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

  it('applying the same stored state twice never duplicates content', () => {
    const store = openStore(':memory:')
    store.create('doc', '')
    const live = new Y.Doc()
    live.getText('source').insert(0, 'exactly once')
    persistRoom(store, 'doc', live)

    const room = new Y.Doc()
    bindRoomState(store, 'doc', room)
    bindRoomState(store, 'doc', room) // second bind, same doc
    Y.applyUpdate(room, store.getYjsState('doc')!) // and a raw re-apply
    expect(room.getText('source').toString()).toBe('exactly once')
    store.close()
  })

  it('survives a large document with long edit history', () => {
    const store = openStore(':memory:')
    store.create('doc', '')
    const live = new Y.Doc()
    const ytext = live.getText('source')
    const paragraph = 'これは長い文書の一部です。 With mixed English and 🌸 emoji.\n'
    for (let i = 0; i < 3000; i++) {
      ytext.insert(ytext.length, paragraph)
      if (i % 3 === 0) {
        ytext.delete(Math.floor(ytext.length / 2), 10)
      }
    }
    persistRoom(store, 'doc', live)
    expect(ytext.length).toBeGreaterThan(100_000)
    expect(restoredText(store, 'doc')).toBe(ytext.toString())
    store.close()
  })

  it('rapid room churn leaves no pending writes behind', () => {
    vi.useFakeTimers()
    try {
      const store = openStore(':memory:')
      store.create('doc', 'base')
      for (let cycle = 0; cycle < 10; cycle++) {
        const room = new Y.Doc()
        bindRoomState(store, 'doc', room, 100)
        room.getText('source').insert(0, `c${cycle} `)
        persistRoom(store, 'doc', room) // writeState on last-client-leave
        room.destroy() // must cancel the pending debounce
      }
      const persisted = restoredText(store, 'doc')
      vi.advanceTimersByTime(10_000)
      // No stray timer fired after destroy: state is unchanged.
      expect(restoredText(store, 'doc')).toBe(persisted)
      expect(persisted).toContain('c9')
      expect(persisted).toContain('base')
      store.close()
    } finally {
      vi.useRealTimers()
    }
  })
})
