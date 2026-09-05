import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'
import type { Env } from './env'
import {
  bindRoomStateWithControl,
  persistRoom,
  type RoomBindingControl,
} from '../collaboration/room-binding'
import { createD1Store } from '../persistence/d1'
import type { DocumentStore } from '../persistence/store'

// Durable Object speaking the y-websocket wire protocol (sync +
// awareness) for one document room. One Object per document ID — the
// single writer for that document's durable state, mirroring the Node
// server where one process owns each in-memory room. State is restored
// from D1 on first use and re-persisted debounced via the shared
// room-binding logic, so durability does not depend on clients leaving
// cleanly. This bundle uses the ESM yjs build throughout; the CJS
// constraint only exists on the Node target (see collaboration/state.ts).

// y-websocket message types.
const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1

export class CollabRoom {
  private store: DocumentStore
  private doc?: Y.Doc
  private awareness?: awarenessProtocol.Awareness
  private binding?: RoomBindingControl
  private loading?: Promise<void>
  // Awareness client IDs controlled by each connection, so a closing
  // connection's presence disappears immediately (same bookkeeping as
  // y-websocket/bin/utils).
  private conns = new Map<WebSocket, Set<number>>()
  private docName = ''

  constructor(
    private state: DurableObjectState,
    env: Env,
  ) {
    this.store = createD1Store(env.DB)
  }

  private async initialize(docName: string): Promise<void> {
    this.docName = docName
    const doc = new Y.Doc()
    const awareness = new awarenessProtocol.Awareness(doc)
    awareness.setLocalState(null)
    awareness.on(
      'update',
      (changes: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        this.trackAwareness(changes, origin)
        this.broadcastAwareness([...changes.added, ...changes.updated, ...changes.removed])
      },
    )
    doc.on('update', (update: Uint8Array) => {
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_SYNC)
      syncProtocol.writeUpdate(encoder, update)
      this.broadcast(encoding.toUint8Array(encoder))
    })
    this.doc = doc
    this.awareness = awareness
    this.binding = await bindRoomStateWithControl(Y, this.store, docName, doc)
  }

  private load(docName: string): Promise<void> {
    if (!this.loading) {
      // bindRoomState restores from D1 (corrupt-blob fallback included)
      // and wires the same debounced persistence as the Node server.
      this.loading = this.initialize(docName)
    }
    return this.loading
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const docName = url.searchParams.get('doc')
    if (!docName) {
      return new Response('missing doc', { status: 400 })
    }
    await this.load(docName)

    // Internal endpoint for the Worker API: current room text, fresher
    // than the debounced persisted state while clients are editing.
    if (url.pathname === '/source') {
      return new Response(this.doc!.getText('source').toString())
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 })
    }
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.accept(server)
    return new Response(null, { status: 101, webSocket: client })
  }

  private accept(ws: WebSocket): void {
    ws.accept()
    // The runtime's default binaryType is 'blob' (browser semantics);
    // the wire protocol needs raw bytes.
    ws.binaryType = 'arraybuffer'
    this.conns.set(ws, new Set())
    ws.addEventListener('message', (event) => {
      this.webSocketMessage(ws, event.data)
    })
    ws.addEventListener('close', (event) => {
      this.webSocketClose(ws, event.code, event.reason, event.wasClean)
    })
    ws.addEventListener('error', (event) => {
      this.webSocketError(ws, event)
    })

    this.sendHandshake(ws)
  }

  private sendHandshake(ws: WebSocket): void {
    // Handshake: sync step 1 plus the current awareness states.
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    syncProtocol.writeSyncStep1(encoder, this.doc!)
    ws.send(encoding.toUint8Array(encoder))
    const states = this.awareness!.getStates()
    if (states.size > 0) {
      const awarenessEncoder = encoding.createEncoder()
      encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness!, [...states.keys()]),
      )
      ws.send(encoding.toUint8Array(awarenessEncoder))
    }
  }

  webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): void {
    try {
      this.handleMessage(ws, data)
    } catch (error) {
      console.error(`collab message failed for ${this.docName}:`, error)
    }
  }

  async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    await this.handleClose(ws)
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    await this.handleClose(ws)
  }

  private handleMessage(ws: WebSocket, data: string | ArrayBuffer): void {
    if (typeof data === 'string') {
      return
    }
    const decoder = decoding.createDecoder(new Uint8Array(data))
    switch (decoding.readVarUint(decoder)) {
      case MESSAGE_SYNC: {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, MESSAGE_SYNC)
        syncProtocol.readSyncMessage(decoder, encoder, this.doc!, ws)
        // Only reply when the handler wrote more than the message type
        // (sync step 2 / requested updates).
        if (encoding.length(encoder) > 1) {
          ws.send(encoding.toUint8Array(encoder))
        }
        break
      }
      case MESSAGE_AWARENESS: {
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness!,
          decoding.readVarUint8Array(decoder),
          ws,
        )
        break
      }
    }
  }

  private async handleClose(ws: WebSocket): Promise<void> {
    const controlled = this.conns.get(ws)
    if (!controlled) {
      return
    }
    this.conns.delete(ws)
    awarenessProtocol.removeAwarenessStates(this.awareness!, [...controlled], null)
    try {
      ws.close()
    } catch {
      // already closed
    }
    if (this.conns.size === 0) {
      // Cancel the debounce before the final write. Pending I/O keeps a
      // Durable Object active automatically; waitUntil has no effect here.
      this.binding?.cancelPendingPersist()
      try {
        await persistRoom(Y, this.store, this.docName, this.doc!)
      } catch (error) {
        console.error(`failed to flush room ${this.docName}:`, error)
      }
    }
  }

  private trackAwareness(
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void {
    const controlled = origin instanceof WebSocket ? this.conns.get(origin) : undefined
    if (!controlled) {
      return
    }
    for (const id of changes.added) {
      controlled.add(id)
    }
    for (const id of changes.removed) {
      controlled.delete(id)
    }
  }

  private broadcastAwareness(changed: number[]): void {
    if (changed.length === 0 || this.conns.size === 0) {
      return
    }
    this.broadcastAwarenessUpdate(awarenessProtocol.encodeAwarenessUpdate(this.awareness!, changed))
  }

  private broadcastAwarenessUpdate(update: Uint8Array): void {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
    encoding.writeVarUint8Array(encoder, update)
    this.broadcast(encoding.toUint8Array(encoder))
  }

  private broadcast(message: Uint8Array): void {
    for (const conn of this.conns.keys()) {
      try {
        conn.send(message)
      } catch {
        void this.handleClose(conn)
      }
    }
  }
}
