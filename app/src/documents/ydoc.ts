import * as Y from 'yjs'

export interface LocalDocument {
  ydoc: Y.Doc
  ytext: Y.Text
  undoManager: Y.UndoManager
  /** Subscribe to the full source after every change, whatever its origin. */
  onSourceChange(cb: (source: string) => void): () => void
  dispose(): void
}

// Insert the persisted source into the shared text exactly once. Guarded so
// that bootstrapping an already-initialized text never duplicates content.
export function initializeSource(ytext: Y.Text, initialSource: string): void {
  if (ytext.length === 0) {
    ytext.insert(0, initialSource)
  }
}

// The live canonical source in the browser is this Y.Text; CodeMirror and
// the preview are both views of it. There is no networking in Phase 2 —
// the Y.Doc lives only in this browser tab.
export function createLocalDocument(initialSource: string): LocalDocument {
  const ydoc = new Y.Doc()
  const ytext = ydoc.getText('source')
  initializeSource(ytext, initialSource)

  // Created after the bootstrap insert so undo can never remove the
  // persisted content, only edits made afterwards.
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
