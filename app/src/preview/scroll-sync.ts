export interface SourceAnchor {
  line: number
  id: string
}

/** Map rendered block positions to a (possibly fractional) source line. */
export function sourceLineForPosition(
  anchors: readonly { line: number; top: number }[],
  top: number,
): number | undefined {
  if (!anchors.length) return undefined
  if (top <= 0) return 1
  // Nested blocks and table cells can share a rendered position. Use the
  // earliest source line at that position, and tolerate reordered layouts.
  const ordered = [...anchors].sort((a, b) => a.top - b.top || a.line - b.line)
  let before = { line: 1, top: 0 }
  for (let index = 0; index < ordered.length; index++) {
    const anchor = ordered[index]!
    if (index > 0 && anchor.top === ordered[index - 1]!.top) continue
    if (anchor.top > top) {
      const progress = (top - before.top) / (anchor.top - before.top)
      return before.line + (anchor.line - before.line) * progress
    }
    before = anchor
  }
  return before.line
}

export interface SourceSpan {
  before?: SourceAnchor
  after?: SourceAnchor
  progress: number
  atEnd: boolean
}

export function sourceSpanForLine(
  anchors: readonly SourceAnchor[],
  line: number,
  atEnd: boolean,
): SourceSpan {
  if (atEnd) {
    return { progress: 1, atEnd: true }
  }

  // Anchors are sorted by source line after conversion. Find the first one
  // after the requested line so scrolling remains cheap for large documents.
  let low = 0
  let high = anchors.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    const anchor = anchors[middle]
    if (anchor && anchor.line <= line) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  const before = low > 0 ? anchors[low - 1] : undefined
  const after = anchors[low]

  if (!before || !after) {
    return { before, after, progress: 0, atEnd: false }
  }

  return {
    before,
    after,
    progress: (line - before.line) / (after.line - before.line),
    atEnd: false,
  }
}
