import { describe, expect, it } from 'vitest'
import {
  sourceLineForPosition,
  sourceSpanForLine,
  type SourceAnchor,
} from '../src/preview/scroll-sync'

describe('source-to-preview scroll synchronization', () => {
  const anchors: SourceAnchor[] = [
    { line: 3, id: 'intro' },
    { line: 8, id: 'details' },
    { line: 20, id: 'summary' },
  ]

  it('uses the document top before the first rendered block', () => {
    expect(sourceSpanForLine(anchors, 1, false)).toEqual({
      before: undefined,
      after: anchors[0],
      progress: 0,
      atEnd: false,
    })
  })

  it('interpolates between surrounding source anchors', () => {
    expect(sourceSpanForLine(anchors, 14, false)).toEqual({
      before: anchors[1],
      after: anchors[2],
      progress: 0.5,
      atEnd: false,
    })
  })

  it('uses the last anchor after its source line', () => {
    expect(sourceSpanForLine(anchors, 25, false)).toEqual({
      before: anchors[2],
      after: undefined,
      progress: 0,
      atEnd: false,
    })
  })

  it('lets the document end override source anchors', () => {
    expect(sourceSpanForLine(anchors, 8, true)).toEqual({
      progress: 1,
      atEnd: true,
    })
  })

  it('uses the last anchor when several share a source line', () => {
    const duplicates = [
      { line: 3, id: 'outer' },
      { line: 3, id: 'inner' },
      { line: 7, id: 'next' },
    ]
    expect(sourceSpanForLine(duplicates, 3, false).before?.id).toBe('inner')
  })
})

describe('preview-to-source positions', () => {
  it('interpolates between rendered blocks and from the document top', () => {
    const anchors = [
      { line: 5, top: 100 },
      { line: 15, top: 300 },
    ]
    expect(sourceLineForPosition(anchors, 0)).toBe(1)
    expect(sourceLineForPosition(anchors, 50)).toBe(3)
    expect(sourceLineForPosition(anchors, 200)).toBe(10)
    expect(sourceLineForPosition(anchors, 400)).toBe(15)
    expect(sourceLineForPosition([], 100)).toBeUndefined()
  })

  it('uses the first source line for coincident blocks and table cells', () => {
    expect(
      sourceLineForPosition(
        [
          { line: 12, top: 200 },
          { line: 6, top: 100 },
          { line: 5, top: 100 },
          { line: 10, top: 200 },
        ],
        150,
      ),
    ).toBe(7.5)
  })
})
