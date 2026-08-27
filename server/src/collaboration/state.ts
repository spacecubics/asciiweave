import { createRequire } from 'node:module'
import type * as YTypes from 'yjs'

// The one yjs module instance for all server-side code. It must be the
// same CommonJS build that y-websocket/bin/utils requires: mixing the
// ESM and CJS builds puts structs from two class hierarchies into one
// document and corrupts sync encoding (see docs/architecture.md).
export const Y = createRequire(import.meta.url)('yjs') as typeof YTypes

// Encode plain AsciiDoc text as a fresh Yjs document state. Used to give
// newly created documents authoritative CRDT state from birth.
export function encodeSourceAsState(source: string): Uint8Array {
  const ydoc = new Y.Doc()
  ydoc.getText('source').insert(0, source)
  return Y.encodeStateAsUpdate(ydoc)
}

// Derive the current plain AsciiDoc text from stored CRDT state.
export function decodeStateToSource(state: Uint8Array): string {
  const ydoc = new Y.Doc()
  Y.applyUpdate(ydoc, state)
  return ydoc.getText('source').toString()
}
