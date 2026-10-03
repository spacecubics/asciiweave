import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { projectRange, trackRange } from '../src/scroll/reading-position'

describe('reading ranges', () => {
  it('follows the same region through remote edits and undo', () => {
    const reader = new Y.Doc()
    const text = reader.getText('source')
    text.insert(0, 'Before\n\nReading paragraph\n\nAfter')
    const from = text.toString().indexOf('Reading')
    const range = trackRange(text, {
      from,
      to: from + 'Reading paragraph'.length,
      kind: 'paragraph',
    })
    const editor = new Y.Doc()
    Y.applyUpdate(editor, Y.encodeStateAsUpdate(reader))
    const remote = editor.getText('source')
    const undo = new Y.UndoManager(remote, { captureTimeout: 0 })
    remote.insert(0, 'Inserted\n\n')
    Y.applyUpdate(reader, Y.encodeStateAsUpdate(editor))
    expect(range.resolve()?.from).toBe(from + 10)
    const saved = range.resolve()!
    expect(text.toString().slice(saved.from, saved.to)).toBe('Reading paragraph')
    remote.insert(saved.from, '////\n')
    Y.applyUpdate(reader, Y.encodeStateAsUpdate(editor))
    expect(range.resolve()?.from).toBe(saved.from + 5)
    undo.undo()
    undo.undo()
    Y.applyUpdate(reader, Y.encodeStateAsUpdate(editor))
    expect(range.resolve()).toEqual({ from, to: from + 17, kind: 'paragraph' })
    undo.destroy()
    editor.destroy()
    reader.destroy()
  })

  it('retains a hidden range while projecting to a visible neighbor', () => {
    const saved = { from: 100, to: 200, kind: 'paragraph' }
    const earlier = { from: 0, to: 30, kind: 'paragraph' }
    const later = { from: 220, to: 250, kind: 'section' }
    expect(projectRange(saved, 0.4, [earlier, later])).toEqual({ target: later, progress: 0 })
    expect(projectRange(saved, 0.4, [])).toBeUndefined()
    expect(projectRange(saved, 0.4, [earlier, saved, later])).toEqual({
      target: saved,
      progress: 0.4,
    })
  })

  it('uses the containing block when syntax merges several source ranges', () => {
    const saved = { from: 100, to: 200, kind: 'paragraph' }
    const listing = { from: 0, to: 400, kind: 'listing' }
    expect(projectRange(saved, 0.4, [listing])).toEqual({ target: listing, progress: 0.35 })
  })

  it('prefers a table row over its containing table', () => {
    const saved = { from: 100, to: 200, kind: 'paragraph' }
    const table = { from: 0, to: 400, kind: 'table' }
    const row = { from: 130, to: 160, kind: 'table-row' }
    expect(projectRange(saved, 0.4, [table, row])?.target).toBe(row)
  })

  it('keeps the viewport offset above a heading', () => {
    const heading = { from: 20, to: 40, kind: 'section' }
    expect(projectRange(heading, -0.2, [heading])).toEqual({ target: heading, progress: -0.2 })
  })

  it('anchors surviving heading text through removal and undo of its marker', () => {
    const doc = new Y.Doc()
    const text = doc.getText('source')
    text.insert(0, '== Heading')
    const saved = trackRange(text, { from: 3, to: 10, kind: 'section' })
    const undo = new Y.UndoManager(text)
    text.delete(0, 3)
    expect(saved.resolve()).toEqual({ from: 0, to: 7, kind: 'section' })
    undo.undo()
    expect(saved.resolve()).toEqual({ from: 3, to: 10, kind: 'section' })
    undo.destroy()
    doc.destroy()
  })
})

it('projects a deleted reading range to a surviving source boundary', () => {
  const doc = new Y.Doc()
  const text = doc.getText('source')
  text.insert(0, 'Before\n\nReading paragraph\nAfter')
  const saved = trackRange(text, { from: 8, to: 25, kind: 'paragraph' })
  text.delete(8, 17)
  expect(saved.resolve()).toEqual({ from: 8, to: 8, kind: 'paragraph' })
  const earlier = { from: 0, to: 6, kind: 'paragraph' }
  const later = { from: 9, to: 14, kind: 'paragraph' }
  expect(projectRange(saved.resolve()!, 0.4, [earlier, later])).toEqual({
    target: later,
    progress: 0,
  })
  doc.destroy()
})
