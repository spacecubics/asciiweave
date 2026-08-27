import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createLocalDocument } from '../src/documents/ydoc'

// Applies an update the way a network provider would: produced by another
// Y.Doc and carrying a non-null transaction origin.
function applyRemote(
  local: ReturnType<typeof createLocalDocument>,
  mutate: (ytext: Y.Text) => void,
) {
  const other = new Y.Doc()
  Y.applyUpdate(other, Y.encodeStateAsUpdate(local.ydoc))
  mutate(other.getText('source'))
  const update = Y.encodeStateAsUpdate(other, Y.encodeStateVector(local.ydoc))
  Y.applyUpdate(local.ydoc, update, 'remote-provider')
}

describe('local Yjs document', () => {
  it('starts empty and receives content through remote-style updates', () => {
    const local = createLocalDocument()
    expect(local.ytext.toString()).toBe('')

    applyRemote(local, (ytext) => ytext.insert(0, '= Seeded by the server\n'))
    expect(local.ytext.toString()).toBe('= Seeded by the server\n')
    local.dispose()
  })

  it('notifies observers with the full source for programmatic changes', () => {
    const local = createLocalDocument()
    local.ytext.insert(0, '= Title\n\nbody\n')
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
    const local = createLocalDocument()
    local.ytext.insert(0, 'base')
    const seen: string[] = []
    local.onSourceChange((source) => seen.push(source))

    local.ydoc.transact(() => {
      local.ytext.insert(4, ' + remote-style edit')
    }, 'simulated-remote-origin')

    expect(seen).toEqual(['base + remote-style edit'])
    local.dispose()
  })

  it('undo/redo covers local edits but never remote updates', () => {
    const local = createLocalDocument()
    applyRemote(local, (ytext) => ytext.insert(0, '= Persisted\n'))

    // Nothing to undo right after opening: remote content is not tracked.
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
    // receive the converged text after a remote-style update.
    const local = createLocalDocument()
    local.ytext.insert(0, '= Doc\n')
    const previewed: string[] = []
    const saved: string[] = []
    local.onSourceChange((source) => {
      previewed.push(source)
      saved.push(source)
    })

    applyRemote(local, (ytext) => ytext.insert(0, 'merged: '))

    expect(local.ytext.toString()).toBe('merged: = Doc\n')
    expect(previewed.at(-1)).toBe('merged: = Doc\n')
    expect(saved.at(-1)).toBe('merged: = Doc\n')
    local.dispose()
  })
})
