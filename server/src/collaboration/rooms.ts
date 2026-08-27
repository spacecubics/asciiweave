import type { Server } from 'node:http'
import { WebSocketServer } from 'ws'
import { setPersistence, setupWSConnection } from 'y-websocket/bin/utils'
import type * as Y from 'yjs'
import type { DocumentStore } from '../persistence/db'

// The collaboration backend is AsciiDoc-agnostic: it relays Yjs document
// updates and awareness messages per room. The asciiweave document ID is
// the room name — there is no second collaboration ID.
const COLLAB_PATH = /^\/collab\/([A-Za-z0-9_-]+)$/

// Seed a freshly created room with the persisted source, exactly once.
// Seeding on the server instead of in each client means two browsers
// opening the same document cannot both insert the initial content.
export function seedRoom(store: DocumentStore, docName: string, ydoc: Y.Doc): void {
  const doc = store.get(docName)
  if (!doc) {
    return
  }
  const ytext = ydoc.getText('source')
  if (ytext.length === 0) {
    ytext.insert(0, doc.source)
  }
}

// Flush the room's current text back to the document store. Called by
// y-websocket when the last client leaves a room; clients also autosave
// over HTTP, so this only narrows the window for losing final edits.
export function writeRoomState(store: DocumentStore, docName: string, ydoc: Y.Doc): void {
  store.updateSource(docName, ydoc.getText('source').toString())
}

export function setupCollaboration(httpServer: Server, store: DocumentStore): void {
  setPersistence({
    provider: null,
    // Both hooks must return promises: y-websocket chains .then() on
    // writeState's return value when the last client leaves a room.
    bindState: async (docName, ydoc) => seedRoom(store, docName, ydoc),
    writeState: async (docName, ydoc) => writeRoomState(store, docName, ydoc),
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
