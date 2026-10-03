import { describe, expect, it } from 'vitest'
import { load } from '@asciidoctor/core'
import { Text } from '@codemirror/state'
import { sourceRanges } from '../src/preview/source-range'

describe('rendered block source ranges', () => {
  for (const newline of ['\n', '\r\n']) {
    for (const closed of [false, true]) {
      it(`bounds a ${closed ? 'closed' : 'unfinished'} listing with ${JSON.stringify(newline)}`, async () => {
        const source = [
          '----',
          'first line',
          'second line',
          ...(closed ? ['----', '', 'Following paragraph.'] : []),
        ].join(newline)
        const doc = await load(source, { sourcemap: true })
        const block = doc.getBlocks()[0]!
        const range = sourceRanges(doc, Text.of(source.split('\n'))).get(block)!
        expect(range.kind).toBe('listing')
        expect(source.slice(range.from, range.to).trimEnd()).toBe(
          ['----', 'first line', 'second line', ...(closed ? ['----'] : [])].join(newline),
        )
      })
    }
  }

  it('uses the source extent when inline content expands', async () => {
    const source = ':label: expanded generated words\n\n{label}\nnext line\n\nFollowing paragraph.'
    const doc = await load(source, { sourcemap: true })
    const range = sourceRanges(doc, Text.of(source.split('\n'))).get(doc.getBlocks()[0]!)!
    expect(source.slice(range.from, range.to)).toBe('{label}\nnext line')
  })

  it('excludes heading punctuation and preserves the complete source title', async () => {
    const source = '== A *formatted* title\n\nParagraph.'
    const doc = await load(source, { sourcemap: true })
    const range = sourceRanges(doc, Text.of(source.split('\n'))).get(doc.getBlocks()[0]!)!
    expect(source.slice(range.from, range.to)).toBe('A *formatted* title')
  })

  it('keeps the source line of an admonition, including its prefix', async () => {
    const source = 'NOTE: A short note.\n\nFollowing paragraph.'
    const doc = await load(source, { sourcemap: true })
    const range = sourceRanges(doc, Text.of(source.split('\n'))).get(doc.getBlocks()[0]!)!
    expect(source.slice(range.from, range.to)).toBe('NOTE: A short note.')
  })
})

it('uses parser locations for document titles after attributes and underlined titles', async () => {
  for (const source of [':lang: en\n\n= Title\n\nText.', 'Title\n=====\n\nText.']) {
    const doc = await load(source, { sourcemap: true })
    const range = sourceRanges(doc, Text.of(source.split('\n'))).get(doc.getHeader())!
    expect(source.slice(range.from, range.to)).toBe('Title')
  }
})
