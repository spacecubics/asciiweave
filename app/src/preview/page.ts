import asciidoctorCss from './asciidoctor.css?raw'
import fontCss from './fonts.css?raw'
import type { PreviewStyle } from './styles'

const previewCsp = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  'img-src data: http: https:',
  'font-src data: http: https:',
  'media-src data: http: https:',
  "object-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
].join('; ')

// Escape less-than signs as CSS escapes, preventing a literal closing style
// tag (including one inside a CSS comment/string) from escaping into HTML.
function styleText(css: string): string {
  return css.replace(/</g, '\\3c ')
}

// Asciidoctor preserves the original untagged language context as well as CSS.
// Additional styles use the source language and explicit font fallbacks.
export function previewPage(html: string, style: PreviewStyle, language = ''): string {
  const lang = style.id === 'default' ? '' : language.replace(/[^a-zA-Z0-9-]/g, '')
  const languageAttribute = lang ? ` lang="${lang}"` : ''
  return (
    `<!doctype html><html${languageAttribute}><head><meta charset="utf-8">` +
    `<base href="about:srcdoc"><meta http-equiv="Content-Security-Policy" content="${previewCsp}">` +
    `<style>${styleText(asciidoctorCss)}</style>` +
    `<style id="preview-fonts">${style.id === 'default' ? '' : styleText(fontCss)}</style>` +
    `<style id="preview-style">${styleText(style.css)}</style></head>` +
    `<body class="article"><div id="content">${html}</div></body></html>`
  )
}

export function applyStyle(document: Document, style: PreviewStyle, language = ''): void {
  const lang = style.id === 'default' ? '' : language.replace(/[^a-zA-Z0-9-]/g, '')
  if (lang) document.documentElement.setAttribute('lang', lang)
  else document.documentElement.removeAttribute('lang')
  const fonts = document.getElementById('preview-fonts')
  if (fonts) fonts.textContent = style.id === 'default' ? '' : fontCss
  const element = document.getElementById('preview-style')
  if (element) element.textContent = style.css
}
