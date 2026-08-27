import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createLocalDocument, initializeSource } from '../src/documents/ydoc'

describe('local Yjs document', () => {
  it('bootstraps the persisted source into Y.Text exactly once', () => {
    const local = createLocalDocument('= Hello\n')
    expect(local.ytext.toString()).toBe('= Hello\n')

    // Re-running the bootstrap must not duplicate the content.
    initializeSource(local.ytext, '= Hello\n')
    expect(local.ytext.toString()).toBe('= Hello\n')
    local.dispose()
  })

  it('notifies observers with the full source for programmatic changes', () => {
    const local = createLocalDocument('= Title\n\nbody\n')
    const seen: string[] = []
    const stop = local.onSourceChange((source) => seen.push(source))

    local.ytext.insert(local.ytext.length, 'appended line\n')
    local.ytext.delete(0, '= Title\n'.length)

    expect(seen).toEqual(['= Title\n\nbody\nappended line\n', '\nbody\nappended line\n'])

    stop()
    local.ytext.insert(0, 'ignored ')
    expect(seen).toHaveLength(2)
    local.dispose()
  })

  it('notifies observers regardless of the transaction origin', () => {
    const local = createLocalDocument('base')
    const seen: string[] = []
    local.onSourceChange((source) => seen.push(source))

    local.ydoc.transact(() => {
      local.ytext.insert(4, ' + remote-style edit')
    }, 'simulated-remote-origin')

    expect(seen).toEqual(['base + remote-style edit'])
    local.dispose()
  })

  it('undo/redo covers user edits but never the bootstrap content', () => {
    const local = createLocalDocument('= Persisted\n')

    // Nothing to undo right after opening: the bootstrap is not tracked.
    local.undoManager.undo()
    expect(local.ytext.toString()).toBe('= Persisted\n')

    local.ytext.insert(local.ytext.length, 'first edit\n')
    local.undoManager.stopCapturing()
    local.ytext.insert(local.ytext.length, 'second edit\n')

    local.undoManager.undo()
    expect(local.ytext.toString()).toBe('= Persisted\nfirst edit\n')
    local.undoManager.undo()
    expect(local.ytext.toString()).toBe('= Persisted\n')
    local.undoManager.undo()
    expect(local.ytext.toString()).toBe('= Persisted\n')

    local.undoManager.redo()
    local.undoManager.redo()
    expect(local.ytext.toString()).toBe('= Persisted\nfirst edit\nsecond edit\n')
    local.dispose()
  })

  it('drives preview and autosave callbacks from Y.Text convergence', () => {
    // Wire the observer the same way main.ts does and verify both sinks
    // receive the converged text after a Yjs-only transaction.
    const local = createLocalDocument('= Doc\n')
    const previewed: string[] = []
    const saved: string[] = []
    local.onSourceChange((source) => {
      previewed.push(source)
      saved.push(source)
    })

    const update = (() => {
      // Apply an update produced by a second Y.Doc, as a remote peer would.
      const other = new Y.Doc()
      Y.applyUpdate(other, Y.encodeStateAsUpdate(local.ydoc))
      other.getText('source').insert(0, 'merged: ')
      return Y.encodeStateAsUpdate(other, Y.encodeStateVector(local.ydoc))
    })()
    Y.applyUpdate(local.ydoc, update)

    expect(local.ytext.toString()).toBe('merged: = Doc\n')
    expect(previewed.at(-1)).toBe('merged: = Doc\n')
    expect(saved.at(-1)).toBe('merged: = Doc\n')
    local.dispose()
  })
})
