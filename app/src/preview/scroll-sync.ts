export interface SourceAnchor {
  line: number
  id: string
}

export function sourceAnchorForLine(
  anchors: readonly SourceAnchor[],
  line: number,
  topId: string,
  endId: string,
  atEnd: boolean,
): string {
  if (atEnd) {
    return endId
  }

  let target = topId
  for (const anchor of anchors) {
    if (anchor.line > line) {
      break
    }
    target = anchor.id
  }
  return target
}
