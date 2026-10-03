import type { AbstractBlock, Block, Document } from '@asciidoctor/core'
import type { Text } from '@codemirror/state'
import type { SourceRange } from '../scroll/reading-position'

function children(block: AbstractBlock): AbstractBlock[] {
  const blocks = block.getBlocks()
  return block.getContext() === 'dlist' ? blocks.flat(2).filter(Boolean) : blocks
}

function terminator(line: string): string | undefined {
  if (/^(?:--|-{4,}|\.{4,}|={4,}|\*{4,}|_{4,}|\+{4,}|[|,!:]===+)$/.test(line)) return line
  if (/^```(?:[^`].*)?$/.test(line)) return '```'
  return undefined
}

/** Map parser blocks to bounded ranges in the original source. */
export function sourceRanges(document: Document, source: Text): Map<AbstractBlock, SourceRange> {
  const ranges = new Map<AbstractBlock, SourceRange>()
  const raw = Array.from({ length: source.lines }, (_, i) => source.line(i + 1).text.trimEnd())
  const clamp = (line: number) => Math.max(1, Math.min(source.lines, line))
  const range = (block: AbstractBlock, first: number, last: number): SourceRange => ({
    from: source.line(clamp(first)).from,
    to: source.line(clamp(last)).to,
    kind: block.getContext(),
  })

  // Content lines can omit comments and conditional branches. Match those lines
  // within the parent and sibling bounds.
  const contentExtent = (block: AbstractBlock, lower: number, upper: number) => {
    const lines = (block as Block).getSourceLines?.()
    if (!lines?.length) return undefined
    const normalize = (line: string) => {
      if (block.getContext() === 'admonition')
        line = line.replace(/^(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION):\s+/, '')
      return line.trim()
    }
    const expected = lines.map(normalize)
    const match = (reverse: boolean): [number, number] | undefined => {
      let next = reverse ? expected.length - 1 : 0
      let first: number | undefined
      const step = reverse ? -1 : 1
      for (let n = reverse ? upper : lower; n >= lower && n <= upper; n += step) {
        if (normalize(raw[n - 1]!) !== expected[next]) continue
        first ??= n
        next += step
        if (next < 0 || next === expected.length) return reverse ? [n, first] : [first, n]
      }
      return undefined
    }
    const earliest = match(false)
    const latest = match(true)
    // Repeated source content can make a match ambiguous after preprocessing.
    return earliest && latest && earliest[0] === latest[0] && earliest[1] === latest[1]
      ? earliest
      : undefined
  }

  const visit = (block: AbstractBlock, lower: number, upper: number): number => {
    const reported = block.getLineNumber()
    const first = Math.max(lower, Math.min(upper, reported ?? lower))
    const kind = block.getContext()
    const nested = children(block)
    if (kind === 'section') {
      const heading = range(block, first, first)
      heading.from += raw[first - 1]!.match(/^=+\s+/)?.[0].length ?? 0
      ranges.set(block, heading)
      return Math.max(first, visitAll(nested, first + 1, upper))
    }
    const end = terminator(raw[first - 1]!)
    if (end && reported !== undefined) {
      let closing: number | undefined
      for (let n = first + 1; n <= upper; n++) {
        if (raw[n - 1] === end) {
          closing = n
          break
        }
      }
      const last = closing ?? upper
      ranges.set(block, range(block, first, last))
      visitAll(nested, first + 1, closing === undefined ? upper : closing - 1)
      return last
    }
    if (kind === 'list_item') {
      const childStart = nested[0]?.getLineNumber() ?? upper + 1
      let last = first
      while (last < Math.min(upper, childStart - 1) && raw[last] && raw[last] !== '+') last++
      last = Math.max(last, visitAll(nested, last + 1, upper))
      ranges.set(block, range(block, first, last))
      return last
    }
    if (['ulist', 'olist', 'dlist', 'colist', 'preamble'].includes(kind)) {
      const last = Math.max(first, visitAll(nested, lower, upper))
      ranges.set(block, range(block, first, last))
      return last
    }
    const extent = contentExtent(block, lower, upper)
    if (extent) {
      ranges.set(block, range(block, ...extent))
      visitAll(nested, extent[0], extent[1])
      return extent[1]
    }
    // Use a source point when the block extent cannot be verified.
    const point = source.line(first).from
    ranges.set(block, { from: point, to: point, kind })
    return Math.max(first, visitAll(nested, first, upper))
  }

  const visitAll = (blocks: AbstractBlock[], lower: number, upper: number): number => {
    let consumed = lower - 1
    for (let i = 0; i < blocks.length;) {
      if (lower > upper) {
        const point = source.line(clamp(upper)).from
        const mark = (block: AbstractBlock) => {
          ranges.set(block, { from: point, to: point, kind: block.getContext() })
          children(block).forEach(mark)
        }
        blocks.slice(i).forEach(mark)
        break
      }
      const first = blocks[i]!
      const line = first.getLineNumber()
      let end = i + 1
      // Description-list terms and their description can share a source line.
      while (end < blocks.length && blocks[end]!.getLineNumber() === line) end++
      const nextLine = blocks[end]?.getLineNumber()
      const limit = nextLine === undefined ? upper : Math.min(upper, Math.max(lower, nextLine - 1))
      for (; i < end; i++) consumed = Math.max(consumed, visit(blocks[i]!, lower, limit))
      lower = consumed + 1
    }
    return consumed
  }

  const header = document.getHeader() as AbstractBlock | null
  if (header) {
    const first = clamp(header.getLineNumber() ?? 1)
    const title = range(header, first, first)
    title.from += raw[first - 1]!.match(/^=+\s+/)?.[0].length ?? 0
    ranges.set(header, title)
  }
  visitAll(document.getBlocks(), 1, source.lines)
  return ranges
}
