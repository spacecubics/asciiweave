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

const followedPositions = new WeakMap<EditorView, number>()
const pendingScrolls = new WeakMap<EditorView, { line: number; atEnd: boolean }>()

function editorTopForLine(view: EditorView, line: number, atEnd: boolean): number {
  const clamped = Math.max(1, Math.min(line, view.state.doc.lines))
  const block = view.lineBlockAt(view.state.doc.line(Math.floor(clamped)).from)
  const top = atEnd
    ? view.scrollDOM.scrollHeight
    : clamped === 1
      ? 0
      : view.documentPadding.top + block.top + block.height * (clamped % 1)
  return Math.max(0, Math.min(top, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight))
}

/** Follow preview scrolling without moving the selection or taking focus. */
export function scrollEditorToLine(view: EditorView, line: number, atEnd: boolean): void {
  const clamped = Math.max(1, Math.min(line, view.state.doc.lines))
  pendingScrolls.set(view, { line: clamped, atEnd })
  view.dispatch({
    effects: EditorView.scrollIntoView(view.state.doc.line(Math.floor(clamped)).from),
  })
}

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
      EditorView.scrollHandler.of((view) => {
        const requested = pendingScrolls.get(view)
        if (!requested) return false
        pendingScrolls.delete(view)
        // Run after CodeMirror measures the destination's virtual lines, so
        // its height correction cannot feed an extra scroll back to preview.
        view.scrollDOM.scrollTop = editorTopForLine(view, requested.line, requested.atEnd)
        followedPositions.set(view, view.scrollDOM.scrollTop)
        return true
      }),
      EditorView.domEventHandlers({
        scroll(_event, view) {
          const followed = followedPositions.get(view)
          if (followed !== undefined && Math.abs(view.scrollDOM.scrollTop - followed) < 1) return
          followedPositions.delete(view)
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
