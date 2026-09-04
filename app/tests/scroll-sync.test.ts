import { describe, expect, it } from 'vitest'
import { sourceAnchorForLine, type SourceAnchor } from '../src/preview/scroll-sync'

describe('source-to-preview scroll synchronization', () => {
  const anchors: SourceAnchor[] = [
    { line: 3, id: 'intro' },
    { line: 8, id: 'details' },
    { line: 20, id: 'summary' },
  ]

  it('uses the top anchor before the first rendered block', () => {
    expect(sourceAnchorForLine(anchors, 1, 'top', 'end', false)).toBe('top')
  })

  it('uses the nearest rendered block at or before the source line', () => {
    expect(sourceAnchorForLine(anchors, 8, 'top', 'end', false)).toBe('details')
    expect(sourceAnchorForLine(anchors, 19, 'top', 'end', false)).toBe('details')
  })

  it('uses the end anchor when the source reaches its scroll limit', () => {
    expect(sourceAnchorForLine(anchors, 8, 'top', 'end', true)).toBe('end')
  })
})
