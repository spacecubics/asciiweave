// Runtime-neutral storage boundary. Both the Node server (node:sqlite)
// and the Cloudflare Worker (D1) implement this interface; API and
// collaboration code depend only on it. Methods are asynchronous even
// though node:sqlite is synchronous, so the D1 implementation fits the
// same shape.

export interface DocumentRecord {
  id: string
  source: string
  // Monotonically increasing persistence revision: 1 at creation,
  // incremented on every persisted snapshot of the derived source.
  revision: number
  created_at: string
  updated_at: string
}

export interface DocumentStore {
  create(id: string, source: string): Promise<DocumentRecord>
  get(id: string): Promise<DocumentRecord | undefined>
  updateSource(id: string, source: string): Promise<boolean>
  // Canonical Yjs collaborative state, stored as an opaque encoded
  // update. Plain AsciiDoc text is a user-facing representation, not a
  // replacement for this.
  getYjsState(id: string): Promise<Uint8Array | undefined>
  setYjsState(id: string, state: Uint8Array): Promise<void>
  close(): void
}
