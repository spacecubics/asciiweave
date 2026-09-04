import { defaultKeymap } from '@codemirror/commands'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { EditorState } from '@codemirror/state'
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'

// The extension list is assembled by hand instead of using basicSetup:
// basicSetup bundles CodeMirror's own history, and there must be exactly
// one undo system — the Yjs-aware one (yUndoManagerKeymap + yCollab).
// No AsciiDoc syntax highlighting in Phase 1/2, per the project
// instructions.
export function createEditor(
  container: HTMLElement,
  ytext: Y.Text,
  undoManager: Y.UndoManager,
  awareness: Awareness,
  onScroll?: (line: number, atEnd: boolean) => void,
): EditorView {
  return new EditorView({
    parent: container,
    doc: ytext.toString(),
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      EditorView.lineWrapping,
      EditorView.domEventHandlers({
        scroll(_event, view) {
          if (!onScroll) {
            return
          }

          // CodeMirror's height coordinate starts below its document padding,
          // while scrollTop includes that padding. Subtract it so a sliver of
          // the preceding line cannot select the following source block.
          const documentTop = view.scrollDOM.scrollTop - view.documentPadding.top
          const firstVisible = view.lineBlockAtHeight(documentTop)
          const line = view.state.doc.lineAt(firstVisible.from).number
          const atEnd =
            view.scrollDOM.scrollTop + view.scrollDOM.clientHeight >=
            view.scrollDOM.scrollHeight - 1
          onScroll(line, atEnd)
        },
      }),
      keymap.of([...yUndoManagerKeymap, ...defaultKeymap, ...searchKeymap]),
      // Passing awareness enables remote cursors and selections, drawn
      // from each collaborator's ephemeral `user` state (name + colors).
      yCollab(ytext, awareness, { undoManager }),
    ],
  })
}
