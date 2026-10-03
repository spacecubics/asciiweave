import type { AbstractBlock, Block, Document } from '@asciidoctor/core'
import type { Text } from '@codemirror/state'
import type { SourceRange } from '../scroll/reading-position'

function children(block: AbstractBlock): AbstractBlock[] {
  const blocks = block.getBlocks()
  return block.getContext() === 'dlist' ? blocks.flat(2).filter(Boolean) : blocks
}

export function sourceRanges(
  document: Document,
  sourceText: Text,
): Map<AbstractBlock, SourceRange> {
  const ranges = new Map<AbstractBlock, SourceRange>()
  const visit = (blocks: AbstractBlock[]) => {
    for (const block of blocks) {
      ranges.set(block, blockSourceRange(block, sourceText))
      visit(children(block))
    }
  }
  const header = document.getHeader() as AbstractBlock | null
  if (header) ranges.set(header, blockSourceRange(header, sourceText))
  visit(document.getBlocks())
  return ranges
}

function blockSourceRange(block: AbstractBlock, sourceText: Text): SourceRange {
  const line = block.getLineNumber() ?? 1
  const first = sourceText.line(Math.max(1, Math.min(sourceText.lines, line)))
  const kind = block.getContext()
  let from = first.from
  const lines = (block as Block).getSourceLines?.()?.length ?? 1
  let to = sourceText.line(Math.min(sourceText.lines, first.number + Math.max(1, lines) - 1)).to
  if (kind === 'section') {
    from += first.text.match(/^=+\s+/)?.[0].length ?? 0
  } else if (kind === 'listing' || kind === 'literal' || kind === 'table') {
    const delimiter = first.text.trimEnd()
    if (/^(?:-{4,}|\.{4,}|[|,!:]===+)$/.test(delimiter)) {
      to = sourceText.length
      for (let n = first.number + 1; n <= sourceText.lines; n++) {
        const last = sourceText.line(n)
        if (last.text.trimEnd() === delimiter) {
          to = last.to
          break
        }
      }
    }
  }
  return { from, to: Math.min(sourceText.length, Math.max(from, to)), kind }
}
