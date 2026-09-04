export interface SourceAnchor {
  line: number
  id: string
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
