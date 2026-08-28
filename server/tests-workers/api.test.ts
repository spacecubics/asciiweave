import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createApp, INITIAL_SOURCE } from '../src/app'
import { createCodec } from '../src/collaboration/codec'
import { createD1Store } from '../src/persistence/d1'
import type { DocumentStore } from '../src/persistence/store'

// The shared Hono app running in the Workers runtime against D1 —
// proving the API path of the Worker target end to end (the Durable
// Object collaboration path is exercised on the staging Worker).
describe('document API on workerd + D1', () => {
  let store: DocumentStore
  let app: ReturnType<typeof createApp>
  const codec = createCodec(Y)

  beforeEach(() => {
    store = createD1Store(env.DB)
    app = createApp(store, codec)
  })

  it('creates a document with authoritative CRDT state and reads it back', async () => {
    const res = await app.request('/api/documents', { method: 'POST' })
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }
    expect(id).toMatch(/^[A-Za-z0-9_-]{14}$/)

    const state = await store.getYjsState(id)
    expect(state).toBeDefined()
    expect(codec.decodeStateToSource(state!)).toBe(INITIAL_SOURCE)

    const doc = (await (await app.request(`/api/documents/${id}`)).json()) as {
      source: string
      revision: number
    }
    expect(doc.source).toBe(INITIAL_SOURCE)
    expect(doc.revision).toBe(1)
  })

  it('returns 404 for unknown documents and health from a live database', async () => {
    expect((await app.request('/api/documents/does-not-exist')).status).toBe(404)
    const health = await app.request('/api/health')
    expect(health.status).toBe(200)
    expect(((await health.json()) as { ok: boolean }).ok).toBe(true)
  })

  it('round-trips Unicode through the CRDT path on D1', async () => {
    const res = await app.request('/api/documents', { method: 'POST' })
    const { id } = (await res.json()) as { id: string }
    const source = '= 見出し\n\n本文です。絵文字 🌸 とアクセント é も保持されます。\n'
    await store.setYjsState(id, codec.encodeSourceAsState(source))
    const doc = (await (await app.request(`/api/documents/${id}`)).json()) as { source: string }
    expect(doc.source).toBe(source)
  })
})
