import * as Y from 'yjs'

export interface LocalDocument {
  ydoc: Y.Doc
  ytext: Y.Text
  undoManager: Y.UndoManager
  /** Subscribe to the full source after every change, whatever its origin. */
  onSourceChange(cb: (source: string) => void): () => void
  dispose(): void
}

// The live canonical source in the browser is this Y.Text; CodeMirror and
// the preview are both views of it. Content arrives through the network
// provider: the server seeds a new room from the persisted source, so the
// client never inserts initial content itself (which two clients could
// otherwise both do).
export function createLocalDocument(): LocalDocument {
  const ydoc = new Y.Doc()
  const ytext = ydoc.getText('source')

  // Remote updates (including the seeded content) carry the provider's
  // transaction origin, which the UndoManager does not track — so undo
  // only ever reverts this user's own edits.
  const undoManager = new Y.UndoManager(ytext)

  return {
    ydoc,
    ytext,
    undoManager,
    onSourceChange(cb) {
      const handler = () => cb(ytext.toString())
      ytext.observe(handler)
      return () => ytext.unobserve(handler)
    },
    dispose() {
      undoManager.destroy()
      ydoc.destroy()
    },
  }
}
