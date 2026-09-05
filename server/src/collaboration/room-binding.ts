import type * as YTypes from 'yjs'
import type { DocumentStore } from '../persistence/store'

// Restore/seed/persist logic for a collaboration room, shared by the
// Node y-websocket server (rooms.ts, CJS yjs) and the Cloudflare
// Durable Object (worker/room.ts, ESM yjs). The yjs module instance is
// injected because the two runtimes must each use exactly one build —
// see codec.ts.

type YModule = typeof YTypes
type YDoc = YTypes.Doc

export const PERSIST_DEBOUNCE_MS = 1000

export interface RoomBindingControl {
  cancelPendingPersist(): void
}

// Seed a freshly created room with the persisted source, exactly once.
// Seeding on the server instead of in each client means two browsers
// opening the same document cannot both insert the initial content.
export async function seedRoom(store: DocumentStore, docName: string, ydoc: YDoc): Promise<void> {
  const doc = await store.get(docName)
  if (!doc) {
    return
  }
  const ytext = ydoc.getText('source')
  if (ytext.length === 0) {
    ytext.insert(0, doc.source)
  }
}

// Persist the room's canonical CRDT state and the derived plain-text
// representation alongside it. Rooms for IDs that are not documents are
// never persisted.
export async function persistRoom(
  Y: YModule,
  store: DocumentStore,
  docName: string,
  ydoc: YDoc,
): Promise<void> {
  if (!(await store.get(docName))) {
    return
  }
  await store.setYjsState(docName, Y.encodeStateAsUpdate(ydoc))
  await store.updateSource(docName, ydoc.getText('source').toString())
}

// Restore a room when the collaboration server creates it. The durable
// Yjs state is canonical; the plain-source seed is only the migration
// path for documents that predate CRDT persistence. Afterwards, every
// room update re-persists the state (debounced), so durability does not
// depend on a graceful shutdown or on the last client leaving.
export async function bindRoomStateWithControl(
  Y: YModule,
  store: DocumentStore,
  docName: string,
  ydoc: YDoc,
  debounceMs: number = PERSIST_DEBOUNCE_MS,
): Promise<RoomBindingControl> {
  const stored = await store.getYjsState(docName)
  let restored = false
  if (stored) {
    try {
      Y.applyUpdate(ydoc, stored)
      restored = true
    } catch (error) {
      // A corrupt blob must never take the document down with it: fall
      // back to the plain-text representation and re-persist from there.
      console.error(`corrupt Yjs state for ${docName}, falling back to plain source:`, error)
    }
  }
  if (!restored) {
    await seedRoom(store, docName, ydoc)
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }
  ydoc.on('update', () => {
    cancel()
    timer = setTimeout(() => {
      timer = undefined
      // A failed write (disk full, closed store) must not crash the
      // process from inside a timer; the next update retries anyway.
      persistRoom(Y, store, docName, ydoc).catch((error: unknown) => {
        console.error(`failed to persist room ${docName}:`, error)
      })
    }, debounceMs)
  })
  ydoc.on('destroy', cancel)
  return { cancelPendingPersist: cancel }
}

// Most room users only need restore plus debounced persistence. Keep the
// original void-returning API for the Node target; the Worker uses the
// controlled variant so a last-client flush can cancel its pending timer.
export async function bindRoomState(
  Y: YModule,
  store: DocumentStore,
  docName: string,
  ydoc: YDoc,
  debounceMs: number = PERSIST_DEBOUNCE_MS,
): Promise<void> {
  await bindRoomStateWithControl(Y, store, docName, ydoc, debounceMs)
}
