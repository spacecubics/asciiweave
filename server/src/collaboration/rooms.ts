import type { Server } from 'node:http'
import { WebSocketServer } from 'ws'
import { docs, setPersistence, setupWSConnection } from 'y-websocket/bin/utils'
import type * as YTypes from 'yjs'
import { Y } from './state'
import type { DocumentStore } from '../persistence/db'

type YDoc = YTypes.Doc

// The collaboration backend is AsciiDoc-agnostic: it relays Yjs document
// updates and awareness messages per room, and touches document content
// only as opaque text or encoded CRDT state. The asciiweave document ID
// is the room name — there is no second collaboration ID.
const COLLAB_PATH = /^\/collab\/([A-Za-z0-9_-]+)$/

const PERSIST_DEBOUNCE_MS = 1000

// Seed a freshly created room with the persisted source, exactly once.
// Seeding on the server instead of in each client means two browsers
// opening the same document cannot both insert the initial content.
export function seedRoom(store: DocumentStore, docName: string, ydoc: YDoc): void {
  const doc = store.get(docName)
  if (!doc) {
    return
  }
  const ytext = ydoc.getText('source')
  if (ytext.length === 0) {
    ytext.insert(0, doc.source)
  }
}

// Persist the room's canonical CRDT state (and the plain-text
// representation alongside it, until Phase 4.3 unifies the stores).
// Rooms for IDs that are not documents are never persisted.
export function persistRoom(store: DocumentStore, docName: string, ydoc: YDoc): void {
  if (!store.get(docName)) {
    return
  }
  store.setYjsState(docName, Y.encodeStateAsUpdate(ydoc))
  store.updateSource(docName, ydoc.getText('source').toString())
}

// Restore a room when y-websocket creates it. The durable Yjs state is
// canonical; the plain-source seed is only the migration path for
// documents that predate CRDT persistence. Afterwards, every room
// update re-persists the state (debounced), so durability does not
// depend on a graceful shutdown or on the last client leaving.
export function bindRoomState(
  store: DocumentStore,
  docName: string,
  ydoc: YDoc,
  debounceMs: number = PERSIST_DEBOUNCE_MS,
): void {
  const stored = store.getYjsState(docName)
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
    seedRoom(store, docName, ydoc)
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  ydoc.on('update', () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      // A failed write (disk full, closed store) must not crash the
      // process from inside a timer; the next update retries anyway.
      try {
        persistRoom(store, docName, ydoc)
      } catch (error) {
        console.error(`failed to persist room ${docName}:`, error)
      }
    }, debounceMs)
  })
  ydoc.on('destroy', () => clearTimeout(timer))
}

// Current text of a live in-memory room, if one is open for this
// document. Fresher than the debounced persisted state by up to the
// debounce interval, so API reads prefer it.
export function getActiveRoomSource(docName: string): string | undefined {
  return docs.get(docName)?.getText('source').toString()
}

export function setupCollaboration(httpServer: Server, store: DocumentStore): void {
  setPersistence({
    provider: null,
    // Both hooks must return promises: y-websocket chains .then() on
    // writeState's return value when the last client leaves a room —
    // and a rejected promise there is an unhandled rejection that would
    // bring the whole process down, so failures stay inside the hook.
    bindState: async (docName, ydoc) => {
      try {
        bindRoomState(store, docName, ydoc)
      } catch (error) {
        console.error(`failed to bind room ${docName}:`, error)
      }
    },
    writeState: async (docName, ydoc) => {
      try {
        persistRoom(store, docName, ydoc)
      } catch (error) {
        console.error(`failed to write room state ${docName}:`, error)
      }
    },
  })

  const wss = new WebSocketServer({ noServer: true })
  httpServer.on('upgrade', (req, socket, head) => {
    const match = COLLAB_PATH.exec(req.url ?? '')
    if (!match?.[1]) {
      socket.destroy()
      return
    }
    const docName = match[1]
    wss.handleUpgrade(req, socket, head, (ws) => {
      setupWSConnection(ws, req, { docName })
    })
  })
}
