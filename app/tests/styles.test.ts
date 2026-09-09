import { describe, expect, it } from 'vitest'
import { discoverStyles, resolveStyle } from '../src/preview/styles'
import { previewPage } from '../src/preview/page'

describe('preview styles', () => {
  it('discovers site-owner files with stable names and deterministic ordering', () => {
    expect(discoverStyles({ './styles/zebra.css': 'z', './styles/my-style.css': 'm' })).toEqual([
      { id: 'default', name: 'Asciidoctor', css: '' },
      { id: 'my-style', name: 'My Style', css: 'm' },
      { id: 'zebra', name: 'Zebra', css: 'z' },
    ])
  })

  it('rejects reserved and ambiguous filenames', () => {
    for (const name of ['default', 'My Style', 'my_style']) {
      expect(() => discoverStyles({ [`./styles/${name}.css`]: '' })).toThrow(
        'Invalid preview style',
      )
    }
  })

  it('falls back when a saved style is absent or malformed', () => {
    for (const id of [null, '', 'removed-style', '{"id":"custom"}', '__proto__']) {
      expect(resolveStyle(id).id).toBe('default')
    }
  })

  it('preserves original language context only for Asciidoctor', () => {
    expect(previewPage('<p>日本語</p>', resolveStyle('default'), 'ja')).toContain('<html>')
    const custom = { id: 'custom', name: 'Custom', css: '' }
    expect(previewPage('<p>日本語</p>', custom, 'ja')).toContain('<html lang="ja">')
    expect(previewPage('<p>Text</p>', custom)).toContain('<html>')
  })

  it('cannot escape a stylesheet into document markup', () => {
    const html = previewPage('<p>Document</p>', {
      id: 'custom',
      name: 'Custom',
      css: '/* </style><script>alert(1)</script> */',
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('\\3c /style>')
    expect(html).toContain('<p>Document</p>')
    expect(previewPage('', resolveStyle('default'), 'ja" onclick="bad')).not.toContain('onclick=')
  })
})
