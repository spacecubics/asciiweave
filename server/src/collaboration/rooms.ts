import type { Server } from 'node:http'
import { WebSocketServer } from 'ws'
import { docs, setPersistence, setupWSConnection } from 'y-websocket/bin/utils'
import type * as YTypes from 'yjs'
import {
  bindRoomState as bindRoomStateNeutral,
  persistRoom as persistRoomNeutral,
  seedRoom,
} from './room-binding'
import { Y } from './state'
import type { DocumentStore } from '../persistence/store'

type YDoc = YTypes.Doc

// The collaboration backend is AsciiDoc-agnostic: it relays Yjs document
// updates and awareness messages per room, and touches document content
// only as opaque text or encoded CRDT state. The asciiweave document ID
// is the room name — there is no second collaboration ID.
const COLLAB_PATH = /^\/collab\/([A-Za-z0-9_-]+)$/

export { seedRoom }

// Node-side wrappers binding the shared room persistence logic
// (room-binding.ts) to the one CJS yjs instance y-websocket uses.
export function persistRoom(store: DocumentStore, docName: string, ydoc: YDoc): void {
  persistRoomNeutral(Y, store, docName, ydoc)
}

export function bindRoomState(
  store: DocumentStore,
  docName: string,
  ydoc: YDoc,
  debounceMs?: number,
): void {
  bindRoomStateNeutral(Y, store, docName, ydoc, debounceMs)
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
