import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { generateDocumentId } from './documents/ids'
import type { DocumentStore } from './persistence/db'

export const INITIAL_SOURCE = '= Untitled Document\n\nStart writing AsciiDoc here.\n'

const MAX_SOURCE_BYTES = 2 * 1024 * 1024

export function createApp(store: DocumentStore) {
  const app = new Hono()

  app.post('/api/documents', (c) => {
    const doc = store.create(generateDocumentId(), INITIAL_SOURCE)
    return c.json({ id: doc.id }, 201)
  })

  app.get('/api/documents/:id', (c) => {
    const doc = store.get(c.req.param('id'))
    if (!doc) {
      return c.json({ error: 'document not found' }, 404)
    }
    return c.json(doc)
  })

  app.put('/api/documents/:id', bodyLimit({ maxSize: MAX_SOURCE_BYTES }), async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }
    const source = (body as { source?: unknown }).source
    if (typeof source !== 'string') {
      return c.json({ error: 'source must be a string' }, 400)
    }
    if (!store.updateSource(c.req.param('id'), source)) {
      return c.json({ error: 'document not found' }, 404)
    }
    return c.json({ ok: true })
  })

  return app
}
