import { load, type AbstractBlock } from '@asciidoctor/core'
import { createRenderScheduler, type RenderScheduler } from './scheduler'
import { sourceAnchorForLine, type SourceAnchor } from './scroll-sync'
import asciidoctorCss from './asciidoctor.css?raw'

interface RenderedPreview {
  html: string
  anchors: SourceAnchor[]
  topId: string
  endId: string
}

export interface Preview extends RenderScheduler {
  /** Follow the first visible source line in the rendered preview. */
  scrollToSourceLine(line: number, atEnd: boolean): void
}

let renderSequence = 0

// The rendered document is user-authored and treated as untrusted relative
// to the application shell. It is displayed in a sandboxed srcdoc iframe
// with neither allow-scripts nor allow-same-origin, so document content
// cannot run script in (or reach into) the asciiweave origin.
export function createPreview(container: HTMLElement): Preview {
  const iframe = document.createElement('iframe')
  iframe.className = 'preview-frame'
  iframe.setAttribute('sandbox', '')
  iframe.title = 'AsciiDoc preview'
  container.appendChild(iframe)

  const page = (preview: RenderedPreview): string =>
    `<!doctype html><html><head><meta charset="utf-8"><style>${asciidoctorCss}</style></head>` +
    `<body class="article"><div id="${preview.topId}"></div>` +
    `<div id="content">${preview.html}</div><div id="${preview.endId}"></div></body></html>`

  let rendered: RenderedPreview | undefined
  let iframeLoaded = false
  let requestedLine = 1
  let requestedEnd = false
  let currentTarget: string | undefined

  const followSource = (): void => {
    if (!rendered || !iframeLoaded) {
      return
    }

    const target = sourceAnchorForLine(
      rendered.anchors,
      requestedLine,
      rendered.topId,
      rendered.endId,
      requestedEnd,
    )

    if (target === currentTarget) {
      return
    }
    currentTarget = target

    // The empty iframe sandbox deliberately makes its document cross-origin.
    // Cross-origin Window scrolling is forbidden, but replacing its location
    // with an about:srcdoc fragment is permitted and scrolls to an anchor
    // without exposing the preview DOM or adding a history entry.
    iframe.contentWindow?.location.replace(`about:srcdoc#${encodeURIComponent(target)}`)
  }

  iframe.addEventListener('load', () => {
    iframeLoaded = true
    followSource()
  })

  const scheduler = createRenderScheduler(
    renderPreview,
    (preview) => {
      rendered = preview
      iframeLoaded = false
      currentTarget = undefined
      iframe.srcdoc = page(preview)
    },
    (error) => {
      const message = error instanceof Error ? error.message : String(error)
      const escaped = message.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      rendered = emptyPreview(
        `<div class="admonitionblock caution"><p>Preview error: ${escaped}</p></div>`,
      )
      iframeLoaded = false
      currentTarget = undefined
      iframe.srcdoc = page(rendered)
    },
  )

  return {
    ...scheduler,
    scrollToSourceLine(line, atEnd) {
      requestedLine = line
      requestedEnd = atEnd
      followSource()
    },
  }
}

async function renderPreview(source: string): Promise<RenderedPreview> {
  const document = await load(source, {
    attributes: { showtitle: true },
    sourcemap: true,
  })
  const prefix = `asciiweave-scroll-${++renderSequence}`
  const anchors: SourceAnchor[] = []
  let generatedId = 0

  const visit = (blocks: AbstractBlock[]): void => {
    for (const block of blocks) {
      const context = block.getContext()
      const line = block.getLineNumber()

      // Preambles have a fixed converter ID, and list items share their first
      // line with the containing list. Their child blocks are still visited.
      if (line !== undefined && context !== 'preamble' && context !== 'list_item') {
        let id = block.getId()
        if (!id) {
          id = `${prefix}-${++generatedId}`
          block.setId(id)
        }
        anchors.push({ line, id })
      }
      visit(block.getBlocks())
    }
  }
  visit(document.getBlocks())
  anchors.sort((left, right) => left.line - right.line)

  return {
    html: await document.convert({ standalone: false }),
    anchors,
    topId: `${prefix}-top`,
    endId: `${prefix}-end`,
  }
}

function emptyPreview(html: string): RenderedPreview {
  const prefix = `asciiweave-scroll-${++renderSequence}`
  return {
    html,
    anchors: [],
    topId: `${prefix}-top`,
    endId: `${prefix}-end`,
  }
}
