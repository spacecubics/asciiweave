import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, INITIAL_SOURCE } from '../src/app'
import type { StateCodec } from '../src/collaboration/codec'
import type { DocumentStore } from '../src/persistence/store'

interface ApiFixture {
  store: DocumentStore
  codec: StateCodec
}

// Run the shared Hono API contract against each runtime's store and Yjs
// codec. Runtime-specific dependencies stay in the test entry points.
export function describeApiContract(makeFixture: () => ApiFixture | Promise<ApiFixture>) {
  describe('document API contract', () => {
    let store: DocumentStore
    let codec: StateCodec
    let app: ReturnType<typeof createApp>

    beforeEach(async () => {
      const fixture = await makeFixture()
      store = fixture.store
      codec = fixture.codec
      app = createApp(store, codec)
    })

    afterEach(() => {
      store.close()
    })

    async function createDoc(): Promise<string> {
      const res = await app.request('/api/documents', { method: 'POST' })
      expect(res.status).toBe(201)
      const { id } = (await res.json()) as { id: string }
      return id
    }

    it('creates documents with unique URL-safe ids', async () => {
      const ids = new Set<string>()
      for (let i = 0; i < 50; i++) {
        const id = await createDoc()
        expect(id).toMatch(/^[A-Za-z0-9_-]{14}$/)
        ids.add(id)
      }
      expect(ids.size).toBe(50)
    })

    it('reports health with database connectivity', async () => {
      const res = await app.request('/api/health')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok: boolean; commit: string }
      expect(body.ok).toBe(true)
      expect(body.commit).toBe('dev')

      const broken = createApp(
        {
          ...store,
          get: async () => {
            throw new Error('database gone')
          },
        },
        codec,
      )
      expect((await broken.request('/api/health')).status).toBe(503)
    })

    it('gives new documents authoritative CRDT state holding the template', async () => {
      const id = await createDoc()
      const state = await store.getYjsState(id)
      expect(state).toBeDefined()
      expect(codec.decodeStateToSource(state!)).toBe(INITIAL_SOURCE)

      const res = await app.request(`/api/documents/${id}`)
      expect(res.status).toBe(200)
      const doc = (await res.json()) as { id: string; source: string; revision: number }
      expect(doc.id).toBe(id)
      expect(doc.source).toBe(INITIAL_SOURCE)
      expect(doc.revision).toBe(1)
    })

    it('returns 404 for unknown documents', async () => {
      const id = `missing-${crypto.randomUUID()}`
      expect((await app.request(`/api/documents/${id}`)).status).toBe(404)
      expect((await app.request(`/api/documents/${id}/source`)).status).toBe(404)
    })

    it('rejects writes: the collaboration path is the only writer', async () => {
      const id = await createDoc()
      const put = await app.request(`/api/documents/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'bypass attempt' }),
      })
      expect(put.status).toBe(404)
      const doc = (await (await app.request(`/api/documents/${id}`)).json()) as { source: string }
      expect(doc.source).toBe(INITIAL_SOURCE)
    })

    it('derives the source from CRDT state, which wins over the text row', async () => {
      const id = await createDoc()
      // Simulate the room persistence cycle having advanced the CRDT
      // state while the derived text row lags behind.
      await store.setYjsState(id, codec.encodeSourceAsState('= Edited Collaboratively\n'))
      const doc = (await (await app.request(`/api/documents/${id}`)).json()) as { source: string }
      expect(doc.source).toBe('= Edited Collaboratively\n')
    })

    it('prefers the live room content over persisted state', async () => {
      const knownId = await createDoc()
      const liveApp = createApp(store, codec, {
        liveSource: (id) => (id === knownId ? 'live room text' : undefined),
      })
      const doc = (await (await liveApp.request(`/api/documents/${knownId}`)).json()) as {
        source: string
      }
      expect(doc.source).toBe('live room text')
    })

    it('falls back to the plain-text row for legacy documents', async () => {
      // D1 shares a database across tests in this file.
      const id = `legacy-${crypto.randomUUID()}`
      await store.create(id, '= Pre-CRDT Document\n')
      const doc = (await (await app.request(`/api/documents/${id}`)).json()) as {
        source: string
      }
      expect(doc.source).toBe('= Pre-CRDT Document\n')
    })

    it('exports plain .adoc source as a download', async () => {
      const id = await createDoc()
      await store.setYjsState(id, codec.encodeSourceAsState('= Export Me\n\n本文です。\n'))
      const res = await app.request(`/api/documents/${id}/source`)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/plain')
      expect(res.headers.get('content-disposition')).toBe(`attachment; filename="${id}.adoc"`)
      expect(await res.text()).toBe('= Export Me\n\n本文です。\n')
    })

    it('round-trips Japanese and Unicode text through the CRDT path', async () => {
      const id = await createDoc()
      const source = '= 見出し\n\n本文です。絵文字 🌸 とアクセント é も保持されます。\n'
      await store.setYjsState(id, codec.encodeSourceAsState(source))
      const doc = (await (await app.request(`/api/documents/${id}`)).json()) as { source: string }
      expect(doc.source).toBe(source)
    })
  })
}
