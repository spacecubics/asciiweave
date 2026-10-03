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

const delimited = [
  ['example', '====', '', 'First paragraph.\n\nLast paragraph.'],
  ['sidebar', '****', '', 'First paragraph.\n\nLast paragraph.'],
  ['quote', '____', '', 'First paragraph.\n\nLast paragraph.'],
  ['open', '--', '', 'First paragraph.\n\nLast paragraph.'],
  ['pass', '++++', '', '<p>First</p>\n<p>Last</p>'],
  ['admonition', '====', '[NOTE]\n', 'First paragraph.\n\nLast paragraph.'],
  ['verse', '____', '[verse]\n', 'First line.\n\nLast line.'],
  ['listing', '----', '', 'First line.\nLast line.'],
  ['listing', '```js', '', 'first()\nlast()'],
  ['literal', '....', '', 'First line.\nLast line.'],
  ['table', '|===', '', '|First |Last'],
] as const

for (const [kind, delimiter, metadata, content] of delimited) {
  for (const newline of ['\n', '\r\n']) {
    for (const closed of [false, true]) {
      it(`maps ${kind} ${delimiter} ${closed ? 'closed' : 'unfinished'} with ${JSON.stringify(newline)}`, async () => {
        const closing = delimiter.startsWith('```') ? '```' : delimiter
        const expected = delimiter + '\n' + content + (closed ? '\n' + closing : '')
        const source = (metadata + expected + (closed ? '\n\nOutside paragraph.' : '')).replaceAll(
          '\n',
          newline,
        )
        const doc = await load(source, { sourcemap: true })
        const block = doc.getBlocks()[0]!
        const range = sourceRanges(doc, Text.of(source.split('\n'))).get(block)!
        expect(range.kind).toBe(kind)
        expect(source.slice(range.from, range.to).trimEnd()).toBe(
          expected.replaceAll('\n', newline),
        )
      })
    }
  }
}

for (const closed of [false, true]) {
  it(`bounds a ${closed ? 'closed' : 'unfinished'} listing by its parent`, async () => {
    const listing = '----\nInside listing.' + (closed ? '\n----' : '')
    const source = '====\n' + listing + '\n====\n\nOutside paragraph.'
    const doc = await load(source, { sourcemap: true })
    const ranges = sourceRanges(doc, Text.of(source.split('\n')))
    const parent = doc.getBlocks()[0]!
    const range = ranges.get(parent.getBlocks()[0]!)!
    expect(source.slice(range.from, range.to)).toBe(listing)
    expect(range.to).toBeLessThan(ranges.get(parent)!.to)
  })
}

it('distinguishes nested delimiters with different lengths', async () => {
  const inner = '======\nInner paragraph.\n======'
  const outer = '====\nOuter paragraph.\n\n' + inner + '\n\nLast outer paragraph.\n===='
  const source = outer + '\n\nOutside paragraph.'
  const doc = await load(source, { sourcemap: true })
  const ranges = sourceRanges(doc, Text.of(source.split('\n')))
  const parent = doc.getBlocks()[0]!
  expect(source.slice(ranges.get(parent)!.from, ranges.get(parent)!.to)).toBe(outer)
  const child = parent.getBlocks()[1]!
  expect(source.slice(ranges.get(child)!.from, ranges.get(child)!.to)).toBe(inner)
})

for (const middle of ['// omitted comment', 'ifdef::missing[]\nOmitted line.\nendif::[]']) {
  it(`maps paragraph content around ${middle.split('\n')[0]}`, async () => {
    const paragraph = 'First line.\n' + middle + '\nLast line.'
    const source = paragraph + '\n\nOutside paragraph.'
    const doc = await load(source, { sourcemap: true })
    const range = sourceRanges(doc, Text.of(source.split('\n'))).get(doc.getBlocks()[0]!)!
    expect(source.slice(range.from, range.to)).toBe(paragraph)
  })
}

for (const list of [
  '* First item.\n* Second item.\n* Last item.',
  '. First item.\n. Second item.\n. Last item.',
  'First:: First description.\nLast:: Last description.',
  '* First *formatted* item.\n  Continued text.\n* Last item.',
  '* First item.\n** Nested item.\n* Last item.',
  '* First item.\n+\n----\nAttached listing.\n----\n* Last item.',
]) {
  it(`maps the full list starting with ${list.split('\n')[0]}`, async () => {
    const source = list + '\n\n.Outside title\n[#outside]\nOutside paragraph.'
    const doc = await load(source, { sourcemap: true })
    const range = sourceRanges(doc, Text.of(source.split('\n'))).get(doc.getBlocks()[0]!)!
    expect(source.slice(range.from, range.to)).toBe(list)
  })
}

it('uses a source point when preprocessing leaves ambiguous repeated content', async () => {
  const source = 'ifdef::missing[]\nSame text.\nendif::[]\nSame text.'
  const doc = await load(source, { sourcemap: true })
  const range = sourceRanges(doc, Text.of(source.split('\n'))).get(doc.getBlocks()[0]!)!
  expect(range.from).toBe(source.lastIndexOf('Same text.'))
  expect(range.to).toBe(range.from)
})

it('keeps conditional delimiters out of an unverified compound extent', async () => {
  const source =
    '====\nifdef::missing[]\n====\nendif::[]\nInside paragraph.\n====\n\nOutside paragraph.'
  const doc = await load(source, { sourcemap: true })
  const ranges = sourceRanges(doc, Text.of(source.split('\n')))
  const parent = doc.getBlocks()[0]!
  const range = ranges.get(parent)!
  expect(range.to).toBe(range.from)
  const child = ranges.get(parent.getBlocks()[0]!)!
  expect(source.slice(child.from, child.to)).toBe('Inside paragraph.')
})
