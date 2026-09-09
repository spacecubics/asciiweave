import { previewPage } from './page'
import { renderPreview } from './preview'
import type { PreviewStyle } from './styles'

/** Print an immutable source/style snapshot, independently of live rendering. */
export async function printDocument(source: string, style: PreviewStyle): Promise<void> {
  const rendered = await renderPreview(source)
  const iframe = document.createElement('iframe')
  iframe.className = 'print-frame'
  iframe.title = 'Printable document'
  iframe.setAttribute('sandbox', 'allow-same-origin allow-modals')
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Print document timed out')), 15_000)
      iframe.addEventListener(
        'load',
        () => {
          clearTimeout(timeout)
          resolve()
        },
        { once: true },
      )
      iframe.srcdoc = previewPage(rendered.html, style, rendered.language)
      document.body.appendChild(iframe)
    })
    const doc = iframe.contentDocument!
    // Image decoding covers cached images too. Failed images should be fixed
    // before export instead of silently producing an incomplete PDF.
    let assetTimeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        Promise.all([doc.fonts.ready, ...Array.from(doc.images, (img) => img.decode())]),
        new Promise<never>((_, reject) => {
          assetTimeout = setTimeout(() => reject(new Error('Print assets timed out')), 15_000)
        }),
      ])
    } finally {
      clearTimeout(assetTimeout)
    }
    doc.title = doc.querySelector('h1')?.textContent || 'AsciiDoc document'
    const frameWindow = iframe.contentWindow!
    await new Promise<void>((resolve) => {
      frameWindow.requestAnimationFrame(() => frameWindow.requestAnimationFrame(() => resolve()))
    })
    // afterprint also fires when the dialog is cancelled. Do not remove the
    // frame immediately on return: some browsers return before the dialog closes.
    frameWindow.addEventListener('afterprint', () => iframe.remove(), { once: true })
    frameWindow.focus()
    frameWindow.print()
  } catch (error) {
    iframe.remove()
    throw error
  }
}
