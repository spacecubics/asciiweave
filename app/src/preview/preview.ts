import { load, type AbstractBlock } from '@asciidoctor/core'
import { createRenderScheduler, type RenderScheduler } from './scheduler'
import type { SourceAnchor } from './scroll-sync'
import asciidoctorCss from './asciidoctor.css?raw'

interface RenderedPreview {
  html: string
  anchors: SourceAnchor[]
}

interface TableCell {
  getLineNumber(): number | null
}

interface TableBlock extends AbstractBlock {
  rows: {
    bySection(): Array<[string, TableCell[][]]>
  }
}

interface TableRowTargets {
  tableId: string
  rowIds: Array<string | undefined>
}

let renderSequence = 0

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

// The parent needs same-origin DOM access to inspect and position the preview.
// Scripts remain disabled by both the sandbox and CSP; nested frames, plugins,
// and form submissions are blocked as well.
export function createPreview(container: HTMLElement): RenderScheduler {
  const iframe = document.createElement('iframe')
  iframe.className = 'preview-frame'
  iframe.setAttribute('sandbox', 'allow-same-origin')
  iframe.title = 'AsciiDoc preview'
  container.appendChild(iframe)

  // A srcdoc document otherwise resolves fragment-only links against the
  // embedding app URL. Keep TOC and other internal links inside the preview.
  const page = (preview: RenderedPreview): string =>
    `<!doctype html><html><head><meta charset="utf-8"><base href="about:srcdoc">` +
    `<meta http-equiv="Content-Security-Policy" content="${previewCsp}">` +
    `<style>${asciidoctorCss}</style></head>` +
    `<body class="article"><div id="content">${preview.html}</div></body></html>`

  return createRenderScheduler(
    renderPreview,
    (preview) => {
      iframe.srcdoc = page(preview)
    },
    (error) => {
      const message = error instanceof Error ? error.message : String(error)
      const escaped = message.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      iframe.srcdoc = page({
        html: `<div class="admonitionblock caution"><p>Preview error: ${escaped}</p></div>`,
        anchors: [],
      })
    },
  )
}

async function renderPreview(source: string): Promise<RenderedPreview> {
  const document = await load(source, {
    attributes: { showtitle: true },
    sourcemap: true,
  })
  const prefix = `asciiweave-source-${++renderSequence}`
  const anchors: SourceAnchor[] = []
  const tableRowTargets: TableRowTargets[] = []
  let generatedId = 0

  const visit = (blocks: AbstractBlock[]): void => {
    for (const block of blocks) {
      const context = block.getContext()
      const line = block.getLineNumber()
      let blockId: string | undefined

      // Preambles have a fixed converter ID, and list items share their first
      // line with the containing list. Their child blocks are still visited.
      if (line !== undefined && context !== 'preamble' && context !== 'list_item') {
        blockId = block.getId()
        if (!blockId) {
          blockId = `${prefix}-${++generatedId}`
          block.setId(blockId)
        }
        anchors.push({ line, id: blockId })
      }

      if (context === 'table' && blockId) {
        const rowIds: Array<string | undefined> = []
        for (const [, rows] of (block as TableBlock).rows.bySection()) {
          for (const row of rows) {
            const lines = new Set(
              row
                .map((cell) => cell.getLineNumber())
                .filter((cellLine): cellLine is number => cellLine !== null),
            )
            if (lines.size === 0) {
              rowIds.push(undefined)
              continue
            }

            const rowId = `${prefix}-${++generatedId}`
            rowIds.push(rowId)
            for (const cellLine of lines) {
              anchors.push({ line: cellLine, id: rowId })
            }
          }
        }
        tableRowTargets.push({ tableId: blockId, rowIds })
      }
      visit(block.getBlocks())
    }
  }
  visit(document.getBlocks())
  anchors.sort((left, right) => left.line - right.line)

  return {
    html: addTableRowAnchors(await document.convert({ standalone: false }), tableRowTargets),
    anchors,
  }
}

function addTableRowAnchors(html: string, targets: TableRowTargets[]): string {
  if (targets.length === 0) {
    return html
  }

  // Template contents are inert, so user-authored markup is not executed in
  // the application while row IDs are added for the script-disabled preview.
  const template = document.createElement('template')
  template.innerHTML = html
  const tables = Array.from(template.content.querySelectorAll('table'))

  for (const target of targets) {
    const table = tables.find((element) => element.id === target.tableId)
    if (!table) {
      continue
    }

    const rows = Array.from(table.children).flatMap((section) =>
      ['THEAD', 'TBODY', 'TFOOT'].includes(section.tagName)
        ? Array.from(section.children).filter((element) => element.tagName === 'TR')
        : [],
    )
    target.rowIds.forEach((rowId, index) => {
      if (rowId && rows[index]) {
        rows[index].id = rowId
      }
    })
  }

  return template.innerHTML
}
