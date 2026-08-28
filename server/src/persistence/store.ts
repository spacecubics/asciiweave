// Runtime-neutral storage boundary. API and collaboration code depend
// only on this interface, never on a concrete database, so a second
// backend (the coming Cloudflare D1 store) can slot in behind it.

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
  create(id: string, source: string): DocumentRecord
  get(id: string): DocumentRecord | undefined
  updateSource(id: string, source: string): boolean
  // Canonical Yjs collaborative state, stored as an opaque encoded
  // update. Plain AsciiDoc text is a user-facing representation, not a
  // replacement for this.
  getYjsState(id: string): Uint8Array | undefined
  setYjsState(id: string, state: Uint8Array): void
  close(): void
}
