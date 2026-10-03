import * as Y from 'yjs'

export interface SourceRange {
  from: number
  to: number
  kind: string
}

export interface TrackedRange {
  resolve(): SourceRange | undefined
}

export function trackRange(text: Y.Text, range: SourceRange): TrackedRange {
  const start = Y.createRelativePositionFromTypeIndex(text, range.from)
  const end = Y.createRelativePositionFromTypeIndex(text, range.to, -1)
  return {
    resolve() {
      if (!text.doc) return undefined
      const from = Y.createAbsolutePositionFromRelativePosition(start, text.doc)
      const to = Y.createAbsolutePositionFromRelativePosition(end, text.doc)
      if (from?.type !== text || to?.type !== text) return undefined
      return { from: from.index, to: Math.max(from.index, to.index), kind: range.kind }
    },
  }
}

/** Choose a display fallback without changing the saved reading range. */
export function projectRange<T extends SourceRange>(
  saved: SourceRange,
  progress: number,
  candidates: readonly T[],
): { target: T; progress: number } | undefined {
  const exact = candidates.find(
    (range) => range.from === saved.from && range.to === saved.to && range.kind === saved.kind,
  )
  if (exact) return { target: exact, progress }
  const position = saved.from + (saved.to - saved.from) * Math.max(0, Math.min(1, progress))
  const distance = (range: SourceRange) => Math.max(range.from - position, position - range.to, 0)
  let target: T | undefined
  for (const range of candidates) {
    if (
      !target ||
      distance(range) < distance(target) ||
      (distance(range) === distance(target) && range.to - range.from < target.to - target.from)
    )
      target = range
  }
  if (!target) return undefined
  return {
    target,
    progress: Math.max(
      0,
      Math.min(1, (position - target.from) / Math.max(1, target.to - target.from)),
    ),
  }
}
