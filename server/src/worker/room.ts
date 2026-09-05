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
// awareness) for one document room. WebSockets are accepted through the
// Hibernation API, so an idle room can leave memory without disconnecting
// browsers. D1 and socket attachments rebuild all in-memory state on wake.

// y-websocket message types.
const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1

interface Attachment {
  docName: string
  controlledIds: number[]
  awarenessUpdate?: Uint8Array
}

interface AttachedSocket {
  ws: WebSocket
  attachment: Attachment
}

function readAttachment(ws: WebSocket): Attachment | undefined {
  const value: unknown = ws.deserializeAttachment()
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const candidate = value as Partial<Attachment>
  if (
    typeof candidate.docName !== 'string' ||
    !Array.isArray(candidate.controlledIds) ||
    !candidate.controlledIds.every((id) => typeof id === 'number')
  ) {
    return undefined
  }
  const update = candidate.awarenessUpdate
  if (update !== undefined && !(update instanceof Uint8Array)) {
    return undefined
  }
  return {
    docName: candidate.docName,
    controlledIds: candidate.controlledIds,
    awarenessUpdate: update,
  }
}

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

    const sockets = this.attachedSockets()
    const first = sockets[0]
    if (first) {
      // Hibernation erases memory but retains accepted sockets. Rebuild the
      // document and presence before the runtime delivers the event that
      // woke this Object.
      this.loading = this.state.blockConcurrencyWhile(() =>
        this.initialize(first.attachment.docName, sockets),
      )
    }
  }

  private attachedSockets(): AttachedSocket[] {
    const sockets: AttachedSocket[] = []
    for (const ws of this.state.getWebSockets()) {
      const attachment = readAttachment(ws)
      if (!attachment) {
        console.error('closing collab socket with a missing or invalid attachment')
        try {
          ws.close(1011, 'invalid room attachment')
        } catch {
          // already closed
        }
        continue
      }
      sockets.push({ ws, attachment })
    }
    return sockets
  }

  private async initialize(docName: string, sockets: AttachedSocket[]): Promise<void> {
    this.docName = docName

    const doc = new Y.Doc()
    const awareness = new awarenessProtocol.Awareness(doc)
    // Awareness's expiry scan is useful in a conventional server but its
    // interval prevents a Durable Object from hibernating. Socket close
    // events remain the authority for removing presence here.
    clearInterval(awareness._checkInterval)
    awareness.setLocalState(null)
    this.doc = doc
    this.awareness = awareness

    for (const { ws, attachment } of sockets) {
      if (attachment.docName !== docName) {
        console.error(`closing collab socket for mismatched room ${attachment.docName}`)
        try {
          ws.close(1011, 'mismatched room attachment')
        } catch {
          // already closed
        }
        continue
      }
      this.conns.set(ws, new Set(attachment.controlledIds))
    }

    // Restore the Yjs document before installing its broadcast listener, so
    // a cold wake does not replay the complete stored document to every peer.
    this.binding = await bindRoomStateWithControl(Y, this.store, docName, doc)

    // Attachments contain complete per-connection snapshots, not merely the
    // last incremental update. Restore all of them before accepting queued
    // messages or sending a handshake to a newly joining browser.
    for (const { ws, attachment } of sockets) {
      if (!this.conns.has(ws) || !attachment.awarenessUpdate) {
        continue
      }
      try {
        awarenessProtocol.applyAwarenessUpdate(awareness, attachment.awarenessUpdate, null)
      } catch (error) {
        console.error(`failed to restore awareness for ${docName}:`, error)
      }
    }

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
  }

  private async load(docName: string): Promise<void> {
    if (!this.loading) {
      this.loading = this.initialize(docName, [])
    }
    await this.loading
    if (this.docName !== docName) {
      throw new Error(`room ${this.docName} cannot serve document ${docName}`)
    }
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
    this.state.acceptWebSocket(ws)
    this.conns.set(ws, new Set())
    this.writeAttachment(ws)

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

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    try {
      await this.loading
      this.handleMessage(ws, data)
    } catch (error) {
      console.error(`collab message failed for ${this.docName}:`, error)
      try {
        ws.close(1011, 'room wake failed')
      } catch {
        // already closed
      }
    }
  }

  async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    await this.loadForSocket(ws)
    await this.handleClose(ws)
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error(`collab socket failed for ${this.docName}:`, error)
    await this.loadForSocket(ws)
    await this.handleClose(ws, true)
  }

  private async loadForSocket(ws: WebSocket): Promise<void> {
    if (this.loading) {
      await this.loading
      return
    }
    const attachment = readAttachment(ws)
    if (!attachment) {
      throw new Error('collab socket has no valid room attachment')
    }
    await this.load(attachment.docName)
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

  private async handleClose(ws: WebSocket, closeSocket = false): Promise<void> {
    const controlled = this.conns.get(ws)
    if (controlled) {
      this.conns.delete(ws)
      awarenessProtocol.removeAwarenessStates(this.awareness!, [...controlled], null)
    } else {
      // A close event may be what wakes the Object. In that case the runtime
      // can omit the already-closing socket from getWebSockets(), so it was
      // not part of constructor-time awareness restoration. Its attachment
      // still contains the clocks needed to tell the remaining peers that
      // those clients have left.
      const attachment = readAttachment(ws)
      if (attachment?.docName === this.docName && attachment.awarenessUpdate) {
        this.broadcastAwarenessUpdate(
          awarenessProtocol.modifyAwarenessUpdate(attachment.awarenessUpdate, () => null),
        )
      }
    }
    if (closeSocket) {
      try {
        ws.close(1011, 'collaboration socket failed')
      } catch {
        // already closed
      }
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
    if (!(origin instanceof WebSocket)) {
      return
    }
    const controlled = this.conns.get(origin)
    if (!controlled) {
      return
    }
    for (const id of changes.added) {
      controlled.add(id)
    }
    for (const id of changes.removed) {
      controlled.delete(id)
    }
    this.writeAttachment(origin)
  }

  private writeAttachment(ws: WebSocket): void {
    const controlled = this.conns.get(ws)
    if (!controlled) {
      return
    }
    const controlledIds = [...controlled]
    const attachment: Attachment = { docName: this.docName, controlledIds }
    let awarenessUpdate: Uint8Array | undefined
    if (controlledIds.length > 0) {
      awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(this.awareness!, controlledIds)
      attachment.awarenessUpdate = awarenessUpdate
    }
    try {
      ws.serializeAttachment(attachment)
    } catch (error) {
      // Attachments have a hard 16,384-byte limit. A compact tombstone keeps
      // the client clocks needed for close cleanup even when an unusually
      // large live presence payload cannot be snapshotted across hibernation.
      console.error(`awareness attachment too large for ${this.docName}:`, error)
      try {
        ws.serializeAttachment({
          docName: this.docName,
          controlledIds,
          awarenessUpdate: awarenessUpdate
            ? awarenessProtocol.modifyAwarenessUpdate(awarenessUpdate, () => null)
            : undefined,
        } satisfies Attachment)
      } catch (fallbackError) {
        console.error(`failed to serialize collab attachment for ${this.docName}:`, fallbackError)
        void this.handleClose(ws, true)
      }
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
