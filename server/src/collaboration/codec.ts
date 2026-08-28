import type * as YTypes from 'yjs'

// Conversions between plain AsciiDoc text and encoded Yjs state,
// parameterized over the yjs module instance. The Node server must use
// the CJS build that y-websocket/bin/utils requires (state.ts), while
// the Cloudflare Worker bundles the ESM build — mixing instances
// corrupts documents, so the instance is injected instead of imported.
export interface StateCodec {
  // Encode plain AsciiDoc text as a fresh Yjs document state. Used to
  // give newly created documents authoritative CRDT state from birth.
  encodeSourceAsState(source: string): Uint8Array
  // Derive the current plain AsciiDoc text from stored CRDT state.
  decodeStateToSource(state: Uint8Array): string
}

export function createCodec(Y: typeof YTypes): StateCodec {
  return {
    encodeSourceAsState(source) {
      const ydoc = new Y.Doc()
      ydoc.getText('source').insert(0, source)
      return Y.encodeStateAsUpdate(ydoc)
    },
    decodeStateToSource(state) {
      const ydoc = new Y.Doc()
      Y.applyUpdate(ydoc, state)
      return ydoc.getText('source').toString()
    },
  }
}
