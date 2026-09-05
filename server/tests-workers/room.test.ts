import { env } from 'cloudflare:workers'
import { evictDurableObject } from 'cloudflare:test'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as Y from 'yjs'
import { createD1Store } from '../src/persistence/d1'

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1

class TestClient {
  readonly doc = new Y.Doc()
  readonly awareness = new awarenessProtocol.Awareness(this.doc)
  private closed = false

  constructor(readonly socket: WebSocket) {
    socket.binaryType = 'arraybuffer'
    socket.addEventListener('message', (event) => this.receive(event.data))
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== socket) {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, MESSAGE_SYNC)
        syncProtocol.writeUpdate(encoder, update)
        socket.send(encoding.toUint8Array(encoder))
      }
    })
    this.awareness.on('update', (_changes: unknown, origin: unknown) => {
      if (!this.closed && origin !== socket) {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]),
        )
        socket.send(encoding.toUint8Array(encoder))
      }
    })
    socket.accept()
  }

  setPresence(name: string): void {
    this.awareness.setLocalState({ user: { name } })
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    this.awareness.destroy()
    this.socket.close(1000, 'test complete')
    this.doc.destroy()
  }

  private receive(data: string | ArrayBuffer): void {
    if (this.closed || typeof data === 'string') {
      return
    }
    const decoder = decoding.createDecoder(new Uint8Array(data))
    switch (decoding.readVarUint(decoder)) {
      case MESSAGE_SYNC: {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, MESSAGE_SYNC)
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, this.socket)
        if (encoding.length(encoder) > 1) {
          this.socket.send(encoding.toUint8Array(encoder))
        }
        break
      }
      case MESSAGE_AWARENESS: {
        const update = decoding.readVarUint8Array(decoder)
        awarenessProtocol.applyAwarenessUpdate(this.awareness, update, this.socket)
        break
      }
    }
  }
}

const clients: TestClient[] = []

afterEach(() => {
  for (const client of clients.splice(0)) {
    client.close()
  }
})

async function createRoom(name: string) {
  const store = createD1Store(env.DB)
  await store.create(name, '')
  const stub = env.ROOMS.get(env.ROOMS.idFromName(name))
  return { store, stub }
}

async function connect(stub: DurableObjectStub, docName: string): Promise<TestClient> {
  const response = await stub.fetch(`https://collab-room/ws?doc=${encodeURIComponent(docName)}`, {
    headers: { Upgrade: 'websocket' },
  })
  expect(response.status).toBe(101)
  expect(response.webSocket).toBeDefined()
  const client = new TestClient(response.webSocket!)
  clients.push(client)
  return client
}

async function expectEventually(assertion: () => void | Promise<void>): Promise<void> {
  await vi.waitFor(assertion, { timeout: 5000, interval: 10 })
}

describe('CollabRoom WebSocket hibernation', () => {
  it('keeps connected editors converged across eviction', async () => {
    const docName = 'eviction-convergence'
    const { stub } = await createRoom(docName)
    const first = await connect(stub, docName)
    const second = await connect(stub, docName)

    first.doc.getText('source').insert(0, 'before wake ')
    await expectEventually(() => {
      expect(second.doc.getText('source').toString()).toBe('before wake ')
    })

    await evictDurableObject(stub)

    second.doc.getText('source').insert(second.doc.getText('source').length, 'after wake')
    await expectEventually(() => {
      expect(first.doc.getText('source').toString()).toBe('before wake after wake')
    })
    expect(await (await stub.fetch(`https://collab-room/source?doc=${docName}`)).text()).toBe(
      'before wake after wake',
    )
  })

  it('restores complete presence before a new editor joins after eviction', async () => {
    const docName = 'eviction-presence'
    const { stub } = await createRoom(docName)
    const first = await connect(stub, docName)
    const second = await connect(stub, docName)
    first.setPresence('Ada')
    second.setPresence('Grace')

    await expectEventually(() => {
      expect(second.awareness.getStates().get(first.doc.clientID)).toEqual({
        user: { name: 'Ada' },
      })
    })
    await evictDurableObject(stub)

    const joining = await connect(stub, docName)
    await expectEventually(() => {
      expect(joining.awareness.getStates().get(first.doc.clientID)).toEqual({
        user: { name: 'Ada' },
      })
      expect(joining.awareness.getStates().get(second.doc.clientID)).toEqual({
        user: { name: 'Grace' },
      })
    })
  })

  it('removes a closed editor presence after waking', async () => {
    const docName = 'eviction-close'
    const { stub } = await createRoom(docName)
    const leaving = await connect(stub, docName)
    const staying = await connect(stub, docName)
    leaving.setPresence('Leaving')
    staying.setPresence('Staying')
    await expectEventually(() => {
      expect(staying.awareness.getStates().has(leaving.doc.clientID)).toBe(true)
    })

    await evictDurableObject(stub)
    const leavingId = leaving.doc.clientID
    leaving.close()
    clients.splice(clients.indexOf(leaving), 1)

    await expectEventually(() => {
      expect(staying.awareness.getStates().has(leavingId)).toBe(false)
    })
    const joining = await connect(stub, docName)
    await expectEventually(() => {
      expect(joining.awareness.getStates().has(leavingId)).toBe(false)
      expect(joining.awareness.getStates().has(staying.doc.clientID)).toBe(true)
    })
  }, 15_000)

  it('flushes the last edit once and cancels the pending debounce', async () => {
    const docName = 'last-client-flush'
    const { store, stub } = await createRoom(docName)
    const client = await connect(stub, docName)
    client.doc.getText('source').insert(0, 'flush me')
    client.close()
    clients.splice(clients.indexOf(client), 1)

    await expectEventually(async () => {
      const stored = await store.get(docName)
      expect(stored?.source).toBe('flush me')
      expect(stored?.revision).toBe(2)
    })
    await new Promise((resolve) => setTimeout(resolve, 1100))
    expect((await store.get(docName))?.revision).toBe(2)
  })

  it('persists an open room through the debounce and restores it after eviction', async () => {
    const docName = 'debounced-persistence'
    const { store, stub } = await createRoom(docName)
    const client = await connect(stub, docName)
    client.doc.getText('source').insert(0, 'durable while connected')

    await expectEventually(async () => {
      const stored = await store.get(docName)
      expect(stored?.source).toBe('durable while connected')
      expect(stored?.revision).toBe(2)
    })
    await evictDurableObject(stub)
    expect(await (await stub.fetch(`https://collab-room/source?doc=${docName}`)).text()).toBe(
      'durable while connected',
    )
  })

  it('keeps the room usable when presence exceeds the attachment limit', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const docName = 'oversized-presence'
      const { stub } = await createRoom(docName)
      const oversized = await connect(stub, docName)
      const peer = await connect(stub, docName)
      oversized.setPresence('x'.repeat(20_000))
      await expectEventually(() => {
        expect(peer.awareness.getStates().has(oversized.doc.clientID)).toBe(true)
      })

      await evictDurableObject(stub)
      const oversizedId = oversized.doc.clientID
      oversized.close()
      clients.splice(clients.indexOf(oversized), 1)
      await expectEventually(() => {
        expect(peer.awareness.getStates().has(oversizedId)).toBe(false)
      })

      peer.doc.getText('source').insert(0, 'still editing')
      await expectEventually(async () => {
        expect(await (await stub.fetch(`https://collab-room/source?doc=${docName}`)).text()).toBe(
          'still editing',
        )
      })
      expect(errors).toHaveBeenCalled()
    } finally {
      errors.mockRestore()
    }
  }, 15_000)
})
