import { Hono } from 'hono'
import { decodeStateToSource, encodeSourceAsState } from './collaboration/state'
import { generateDocumentId } from './documents/ids'
import type { DocumentStore } from './persistence/db'

export const INITIAL_SOURCE = '= Untitled Document\n\nStart writing AsciiDoc here.\n'

// The durable Yjs state is the one authoritative document store; the
// collaboration path (WebSocket + server-side persistence) is the only
// writer. Plain AsciiDoc source is derived data: current room text if a
// room is live, else decoded CRDT state, else the legacy plain-text row
// for documents that predate CRDT persistence.
export function createApp(store: DocumentStore, liveSource?: (id: string) => string | undefined) {
  const app = new Hono()

  const deriveSource = (id: string, legacy: string): string => {
    const live = liveSource?.(id)
    if (live !== undefined) {
      return live
    }
    const state = store.getYjsState(id)
    return state ? decodeStateToSource(state) : legacy
  }

  app.post('/api/documents', (c) => {
    const doc = store.create(generateDocumentId(), INITIAL_SOURCE)
    // Authoritative CRDT state exists from birth; the plain-text row is
    // only a derived representation.
    store.setYjsState(doc.id, encodeSourceAsState(INITIAL_SOURCE))
    return c.json({ id: doc.id }, 201)
  })

  app.get('/api/documents/:id', (c) => {
    const doc = store.get(c.req.param('id'))
    if (!doc) {
      return c.json({ error: 'document not found' }, 404)
    }
    return c.json({ ...doc, source: deriveSource(doc.id, doc.source) })
  })

  // Plain .adoc export for committing to Git — derived from the
  // collaborative state, never a separate store.
  app.get('/api/documents/:id/source', (c) => {
    const doc = store.get(c.req.param('id'))
    if (!doc) {
      return c.json({ error: 'document not found' }, 404)
    }
    c.header('content-type', 'text/plain; charset=utf-8')
    c.header('content-disposition', `attachment; filename="${doc.id}.adoc"`)
    return c.body(deriveSource(doc.id, doc.source))
  })

  return app
}
