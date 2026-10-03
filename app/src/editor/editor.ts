import { defaultKeymap } from '@codemirror/commands'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { EditorState } from '@codemirror/state'
import {
  EditorView,
  ViewPlugin,
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
import { trackRange } from '../scroll/reading-position'
import type { ScrollCoordinator, ScrollRequest, SourcePosition } from '../scroll/coordinator'

function editorTopForLine(view: EditorView, line: number, atEnd: boolean): number {
  const number = Math.max(1, Math.min(Math.floor(line), view.state.doc.lines))
  const block = view.lineBlockAt(view.state.doc.line(number).from)
  const top = atEnd
    ? view.scrollDOM.scrollHeight
    : line === 1
      ? 0
      : view.documentPadding.top + block.top + block.height * (line % 1)
  return Math.max(0, Math.min(top, view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight))
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
  sync: ScrollCoordinator,
): EditorView {
  let observedTop = 0
  let width = 0
  let height = 0
  let pending: { position: SourcePosition; current: ScrollRequest } | undefined
  const follow = (position: SourcePosition, current: ScrollRequest): void => {
    pending = { position, current }
    const line = Math.max(1, Math.min(Math.floor(position.line), view.state.doc.lines))
    view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(line).from) })
  }
  const resized = (): boolean => {
    const nextWidth = view.scrollDOM.clientWidth
    const nextHeight = view.scrollDOM.clientHeight
    if (width === nextWidth && height === nextHeight) return false
    width = nextWidth
    height = nextHeight
    sync.layoutChanged('source')
    return true
  }
  const scrolled = (): void => {
    const top = view.scrollDOM.scrollTop
    if (resized()) {
      observedTop = top
      return
    }
    if (Math.abs(top - observedTop) < 1) return
    observedTop = top
    sync.navigate('source')
  }
  const measuredScroll = (): void => {
    observedTop = view.scrollDOM.scrollTop
  }
  const cancelFollow = (): void => {
    if (pending) pending.current = () => false
  }
  const capture = () => {
    // Measuring virtual lines can correct scrollTop before the bookmark read.
    view.lineBlockAt(0)
    const atStart = view.scrollDOM.scrollTop === 0
    const top = view.scrollDOM.scrollTop - view.documentPadding.top
    const block = view.lineBlockAtHeight(top)
    const number = view.state.doc.lineAt(block.from).number
    const progress = Math.max(0, Math.min((top - block.top) / block.height, 1))
    const atEnd =
      view.scrollDOM.scrollTop > 0 &&
      view.scrollDOM.scrollTop + view.scrollDOM.clientHeight >= view.scrollDOM.scrollHeight - 1
    const line = view.state.doc.line(number)
    const range = trackRange(ytext, { from: line.from, to: line.to, kind: 'source-line' })
    const currentLine = () =>
      atStart
        ? 1
        : view.state.doc.lineAt(Math.min(range.resolve()?.from ?? 0, view.state.doc.length)).number
    observedTop = view.scrollDOM.scrollTop
    return {
      get position() {
        return { line: currentLine(), atEnd }
      },
      restore: (current: ScrollRequest) =>
        follow({ line: currentLine() + progress, atEnd }, current),
    }
  }
  const applyScroll = (view: EditorView): boolean => {
    const request = pending
    if (!request) return false
    pending = undefined
    if (request.current()) {
      view.scrollDOM.scrollTop = editorTopForLine(
        view,
        request.position.line,
        request.position.atEnd,
      )
      observedTop = view.scrollDOM.scrollTop
    }
    return true
  }
  const observer = new ResizeObserver(resized)
  const view = new EditorView({
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
      ViewPlugin.define(() => ({
        destroy() {
          observer.disconnect()
          view.scrollDOM.removeEventListener('scroll', measuredScroll)
        },
      })),
      EditorView.updateListener.of((update) => {
        // CodeMirror can adjust scrollTop while measuring changed line heights.
        // Record the correction before the scroll handler treats it as navigation.
        if (update.geometryChanged) observedTop = update.view.scrollDOM.scrollTop
      }),
      EditorView.scrollHandler.of(applyScroll),
      EditorView.domEventHandlers({
        scroll: scrolled,
        wheel: cancelFollow,
        pointerdown: cancelFollow,
        keydown: cancelFollow,
        touchstart: cancelFollow,
      }),
      keymap.of([...yUndoManagerKeymap, ...defaultKeymap, ...searchKeymap]),
      // Passing awareness enables remote cursors and selections, drawn
      // from each collaborator's ephemeral `user` state (name + colors).
      yCollab(ytext, awareness, { undoManager }),
    ],
  })
  width = view.scrollDOM.clientWidth
  height = view.scrollDOM.clientHeight
  // Height corrections finish after the navigation handler above.
  view.scrollDOM.addEventListener('scroll', measuredScroll)
  sync.attach('source', {
    poll: scrolled,
    follow,
    capture,
  })
  observer.observe(view.scrollDOM)
  return view
}
