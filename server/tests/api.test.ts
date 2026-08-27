import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, INITIAL_SOURCE } from '../src/app'
import { openStore, type DocumentStore } from '../src/persistence/db'

describe('document API', () => {
  let store: DocumentStore
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    store = openStore(':memory:')
    app = createApp(store)
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

  it('initializes new documents with the template source', async () => {
    const id = await createDoc()
    const res = await app.request(`/api/documents/${id}`)
    expect(res.status).toBe(200)
    const doc = (await res.json()) as { id: string; source: string }
    expect(doc.id).toBe(id)
    expect(doc.source).toBe(INITIAL_SOURCE)
  })

  it('returns 404 for unknown documents', async () => {
    const res = await app.request('/api/documents/does-not-exist')
    expect(res.status).toBe(404)
  })

  it('updates a document via PUT', async () => {
    const id = await createDoc()
    const put = await app.request(`/api/documents/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: '= Edited\n' }),
    })
    expect(put.status).toBe(200)
    const doc = (await (await app.request(`/api/documents/${id}`)).json()) as {
      source: string
    }
    expect(doc.source).toBe('= Edited\n')
  })

  it('rejects PUT to unknown documents and invalid bodies', async () => {
    const id = await createDoc()
    const missing = await app.request('/api/documents/unknown-id', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'x' }),
    })
    expect(missing.status).toBe(404)

    const badType = await app.request(`/api/documents/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 42 }),
    })
    expect(badType.status).toBe(400)

    const badJson = await app.request(`/api/documents/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    })
    expect(badJson.status).toBe(400)
  })

  it('keeps two documents isolated', async () => {
    const a = await createDoc()
    const b = await createDoc()
    await app.request(`/api/documents/${a}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'only a changed' }),
    })
    const docB = (await (await app.request(`/api/documents/${b}`)).json()) as {
      source: string
    }
    expect(docB.source).toBe(INITIAL_SOURCE)
  })

  it('round-trips Japanese and Unicode text through the API', async () => {
    const id = await createDoc()
    const source = '= 見出し\n\n本文です。絵文字 🌸 とアクセント é も保持されます。\n'
    await app.request(`/api/documents/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source }),
    })
    const doc = (await (await app.request(`/api/documents/${id}`)).json()) as {
      source: string
    }
    expect(doc.source).toBe(source)
  })
})
