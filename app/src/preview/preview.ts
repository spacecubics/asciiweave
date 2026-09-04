import { convert } from '@asciidoctor/core'
import { createRenderScheduler, type RenderScheduler } from './scheduler'
import asciidoctorCss from './asciidoctor.css?raw'

// The rendered document is user-authored and treated as untrusted relative
// to the application shell. It is displayed in a sandboxed srcdoc iframe
// with neither allow-scripts nor allow-same-origin, so document content
// cannot run script in (or reach into) the asciiweave origin.
export function createPreview(container: HTMLElement): RenderScheduler {
  const iframe = document.createElement('iframe')
  iframe.className = 'preview-frame'
  iframe.setAttribute('sandbox', '')
  iframe.title = 'AsciiDoc preview'
  container.appendChild(iframe)

  // A srcdoc document otherwise resolves fragment-only links against the
  // embedding app URL. Keep TOC and other internal links inside the preview.
  const page = (body: string): string =>
    `<!doctype html><html><head><meta charset="utf-8"><base href="about:srcdoc">` +
    `<style>${asciidoctorCss}</style></head>` +
    `<body class="article"><div id="content">${body}</div></body></html>`

  return createRenderScheduler(
    (source) => convert(source, { attributes: { showtitle: true } }) as Promise<string>,
    (html) => {
      iframe.srcdoc = page(html)
    },
    (error) => {
      const message = error instanceof Error ? error.message : String(error)
      const escaped = message.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      iframe.srcdoc = page(
        `<div class="admonitionblock caution"><p>Preview error: ${escaped}</p></div>`,
      )
    },
  )
}
