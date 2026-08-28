import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'
import type { Env } from './env'
import { bindRoomState, persistRoom } from '../collaboration/room-binding'
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

  private load(docName: string): Promise<void> {
    if (!this.loading) {
      this.docName = docName
      const doc = new Y.Doc()
      this.awareness = new awarenessProtocol.Awareness(doc)
      this.awareness.setLocalState(null)
      this.awareness.on(
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
      // bindRoomState restores from D1 (corrupt-blob fallback included)
      // and wires the same debounced persistence as the Node server.
      this.loading = bindRoomState(Y, this.store, docName, doc)
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
    this.conns.set(ws, new Set())
    ws.addEventListener('message', (event) => {
      try {
        this.handleMessage(ws, event.data)
      } catch (error) {
        console.error(`collab message failed for ${this.docName}:`, error)
      }
    })
    const close = () => this.handleClose(ws)
    ws.addEventListener('close', close)
    ws.addEventListener('error', close)

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

  private handleClose(ws: WebSocket): void {
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
      // Last client left: flush immediately instead of waiting out the
      // debounce, in case the Object is evicted while idle.
      this.state.waitUntil(
        persistRoom(Y, this.store, this.docName, this.doc!).catch((error: unknown) => {
          console.error(`failed to flush room ${this.docName}:`, error)
        }),
      )
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
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness!, changed),
    )
    this.broadcast(encoding.toUint8Array(encoder))
  }

  private broadcast(message: Uint8Array): void {
    for (const conn of this.conns.keys()) {
      try {
        conn.send(message)
      } catch {
        this.handleClose(conn)
      }
    }
  }
}
