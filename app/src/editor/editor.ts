import { basicSetup, EditorView } from 'codemirror'

// basicSetup provides line numbers, history (undo/redo), and search.
// No AsciiDoc syntax highlighting in Phase 1, per the project instructions.
export function createEditor(
  container: HTMLElement,
  initialSource: string,
  onChange: (source: string) => void,
): EditorView {
  return new EditorView({
    parent: container,
    doc: initialSource,
    extensions: [
      basicSetup,
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChange(update.state.doc.toString())
        }
      }),
    ],
  })
}
