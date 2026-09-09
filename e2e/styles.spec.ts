import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { createDoc, getText, replaceSource, setSourceViaYjs } from './helpers'

const fixture = readFileSync(new URL('./fixtures/styles.adoc', import.meta.url), 'utf8')

test('styles preserve content, fonts, source, and the Asciidoctor baseline', async ({ page }) => {
  await createDoc(page)
  await replaceSource(page, fixture)
  const frame = page.frameLocator('.preview-frame')
  const heading = frame.getByRole('heading', { name: 'Overview', exact: true })
  await expect(heading).toBeVisible()
  const currentColor = await heading.evaluate((e) => getComputedStyle(e).color)
  const currentFont = await heading.evaluate((e) => getComputedStyle(e).fontFamily)
  const select = page.getByLabel('Preview style', { exact: true })
  await expect(select).toHaveValue('default')
  await select.selectOption('space-cubics')
  await expect(heading).toHaveCSS('color', 'rgb(0, 0, 0)')
  await expect(heading).toHaveCSS('font-family', /IPAGothic.*sans-serif$/)
  await expect(frame.locator('strong').filter({ hasText: '強調' })).toHaveCSS('font-weight', '700')
  await expect(frame.locator('table.tableblock thead')).toHaveCSS(
    'background-color',
    'rgb(227, 228, 232)',
  )
  await select.selectOption('git-docs')
  await expect(heading).toHaveCSS('color', 'rgb(241, 78, 50)')
  await expect(frame.locator('pre').first()).toHaveCSS(
    'font-family',
    /^Courier, IPAGothic,.*monospace$/,
  )
  await expect(frame.locator('table.tableblock thead')).toHaveCSS(
    'background-color',
    'rgb(238, 236, 229)',
  )
  await select.selectOption('default')
  await expect(heading).toHaveCSS('color', currentColor)
  await expect(heading).toHaveCSS('font-family', currentFont)
  await expect(frame.locator('body')).toHaveCSS(
    'font-family',
    '"Noto Serif", "DejaVu Serif", serif',
  )
  await expect(frame.locator('pre').first()).toHaveCSS(
    'font-family',
    '"Droid Sans Mono", "DejaVu Sans Mono", monospace',
  )
  expect(await getText(page)).toBe(fixture)
  const exported = await page.request.get(
    `${new URL(page.url()).pathname.replace('/doc/', '/api/documents/')}/source`,
  )
  expect(await exported.text()).toBe(fixture)
})

test('printing captures the latest source and style in an isolated document', async ({ page }) => {
  await createDoc(page)
  await replaceSource(page, fixture)
  await page.getByLabel('Preview style', { exact: true }).selectOption('space-cubics')
  // Intercept only the browser dialog. Inspect the real prepared print document
  // and exercise its afterprint cleanup, including the cancellation path.
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      const iframe = document.querySelector<HTMLIFrameElement>('.print-frame')
      if (!iframe) return
      observer.disconnect()
      iframe.addEventListener(
        'load',
        () => {
          iframe.contentWindow!.print = () => {
            iframe.dataset.printCalled = 'true'
          }
        },
        { once: true },
      )
    })
    observer.observe(document.body, { childList: true })
  })
  // No wait for the debounced preview: printing must render this source itself.
  await setSourceViaYjs(page, '= Latest snapshot\n' + fixture.replace(/^= .*\n/, ''))
  await page.getByRole('button', { name: 'Print / Save as PDF' }).click()
  const printFrame = page.locator('.print-frame')
  await expect(printFrame).toHaveAttribute('data-print-called', 'true')
  await expect(printFrame).toHaveAttribute('sandbox', 'allow-same-origin allow-modals')
  const print = page.frameLocator('.print-frame')
  await expect(print.locator('h1')).toHaveText('Latest snapshot')
  await expect(print.locator('html')).toHaveAttribute('lang', 'ja')
  await expect(print.locator('h2').first()).toHaveCSS('color', 'rgb(0, 0, 0)')
  await setSourceViaYjs(page, '= Changed after print\n\nNew text')
  await page.getByLabel('Preview style', { exact: true }).selectOption('git-docs')
  await expect(print.locator('h1')).toHaveText('Latest snapshot')
  await expect(print.locator('html')).toHaveAttribute('lang', 'ja')
  await expect(print.locator('h2').first()).toHaveCSS('color', 'rgb(0, 0, 0)')
  await printFrame.evaluate((element: HTMLIFrameElement) => {
    element.contentWindow!.dispatchEvent(new Event('afterprint'))
  })
  await expect(printFrame).toHaveCount(0)
})

test('print errors use an existing alert region and can be repeated', async ({ page }) => {
  await page.route('https://example.com/missing.png', (route) => route.abort())
  await createDoc(page)
  const alert = page.getByRole('alert')
  // The empty region must already be exposed before its content changes.
  await expect(alert).toHaveCount(1)
  await expect(alert).toBeEmpty()
  await replaceSource(page, '= Image failure\n\nimage::https://example.com/missing.png[]')
  const button = page.getByRole('button', { name: 'Print / Save as PDF' })
  for (let attempt = 0; attempt < 2; attempt++) {
    await button.click()
    await expect(alert).toContainText('Could not prepare the PDF')
    await expect(button).toBeEnabled()
    await expect(page.locator('.print-frame')).toHaveCount(0)
  }
})

test('printing waits for initial sync and remains available offline', async ({ page }) => {
  await createDoc(page)
  let release: (() => void) | undefined
  await page.routeWebSocket('**/collab/**', (socket) => {
    const server = socket.connectToServer()
    const pending: Array<string | Buffer> = []
    let paused = true
    server.onMessage((message) => {
      if (paused) pending.push(message)
      else socket.send(message)
    })
    release = () => {
      paused = false
      for (const message of pending) socket.send(message)
    }
  })
  await page.reload()
  const button = page.getByRole('button', { name: 'Print / Save as PDF' })
  await expect(page.locator('#sync-state')).toHaveText('Connecting…')
  expect(await getText(page)).toBe('')
  await expect(button).toBeDisabled()
  await expect.poll(() => Boolean(release)).toBe(true)
  release!()
  await expect(page.locator('#sync-state')).toHaveText('Synced')
  await expect(button).toBeEnabled()
  await page.evaluate(() => window.__asciiweave!.provider.disconnect())
  await expect(page.locator('#sync-state')).toHaveText('Offline')
  await expect(button).toBeEnabled()
  await replaceSource(page, '= Offline edit\n\nPrintable without reconnecting.')
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      const iframe = document.querySelector<HTMLIFrameElement>('.print-frame')
      if (!iframe) return
      observer.disconnect()
      iframe.addEventListener(
        'load',
        () => {
          iframe.contentWindow!.addEventListener('beforeprint', () => {
            document.body.dataset.printedTitle =
              iframe.contentDocument!.querySelector('h1')!.textContent!
          })
        },
        { once: true },
      )
    })
    observer.observe(document.body, { childList: true })
  })
  await button.click()
  await expect(page.locator('body')).toHaveAttribute('data-printed-title', 'Offline edit')
})

test('sample styles use explicit Japanese fonts in headings, prose, and code', async ({ page }) => {
  await createDoc(page)
  await replaceSource(
    page,
    '= Font comparison\n:lang: ja\n\n== 要求根拠と日本語の見出し\n\n日本語の本文。\n\n[source,text]\n----\n日本語のコード\n----',
  )
  const preview = page.frameLocator('.preview-frame')
  await expect(preview.locator('h2')).toContainText('要求根拠')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  const fonts = async () => {
    await page.locator('.preview-frame').evaluate(async (iframe: HTMLIFrameElement) => {
      await iframe.contentDocument!.fonts.ready
    })
    // Measure only the Japanese glyphs, excluding the code block's trailing
    // newline, which Chromium can attribute to a Latin font in print layout.
    await preview.locator('pre code').evaluate((code) => {
      const span = document.createElement('span')
      span.textContent = code.textContent!.trim()
      code.replaceChildren(span)
      span.getBoundingClientRect()
    })
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: '.preview-frame',
    })
    const { node } = await cdp.send('DOM.describeNode', { nodeId })
    const result: Record<string, string[]> = {}
    for (const selector of ['h2', '.paragraph p', 'pre code span']) {
      const { nodeId: textId } = await cdp.send('DOM.querySelector', {
        nodeId: node.contentDocument!.nodeId,
        selector,
      })
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId: textId })
      result[selector] = [...new Set(fonts.map((font) => font.familyName))].sort()
      expect(result[selector].length).toBeGreaterThan(0)
    }
    return result
  }
  try {
    await page.getByLabel('Preview style', { exact: true }).selectOption('space-cubics')
    const originalFonts = await fonts()
    await expect(preview.locator('h2')).toHaveCSS('font-family', /IPAGothic.*sans-serif$/)
    await expect(preview.locator('html')).toHaveAttribute('lang', 'ja')
    await page.getByLabel('Preview style', { exact: true }).selectOption('space-cubics')
    expect(await fonts()).toEqual(originalFonts)
    await page.reload()
    await expect(preview.locator('h2')).toContainText('要求根拠')
    expect(await fonts()).toEqual(originalFonts)
    await page.getByLabel('Preview style', { exact: true }).selectOption('git-docs')
    expect(await fonts()).toEqual(originalFonts)
    await expect(preview.locator('html')).toHaveAttribute('lang', 'ja')
    await page.emulateMedia({ media: 'print' })
    for (const style of ['space-cubics', 'git-docs']) {
      await page.getByLabel('Preview style', { exact: true }).selectOption(style)
      expect(await fonts()).toEqual(originalFonts)
    }
  } finally {
    await cdp.detach()
  }
})

test('small Git Docs headings meet normal-text contrast', async ({ page }) => {
  await createDoc(page)
  await replaceSource(
    page,
    Array.from({ length: 6 }, (_, n) => `${'='.repeat(n + 1)} Heading ${n + 1}\n\nText.\n`).join(
      '\n',
    ),
  )
  await page.getByLabel('Preview style', { exact: true }).selectOption('git-docs')
  const preview = page.frameLocator('.preview-frame')
  await expect(preview.locator('h6')).toHaveText('Heading 6')
  await expect(preview.locator('h2')).toHaveCSS('color', 'rgb(241, 78, 50)')
  for (const media of ['screen', 'print'] as const) {
    await page.emulateMedia({ media })
    const ratios = await preview.locator('h3, h4, h5, h6').evaluateAll((headings) => {
      const luminance = (color: string) => {
        const channels = color
          .match(/\d+/g)!
          .slice(0, 3)
          .map(Number)
          .map((c) => {
            const value = c / 255
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
          })
        return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
      }
      const background = luminance(
        getComputedStyle(document.querySelector('#content')!).backgroundColor,
      )
      return headings.map((heading) => {
        const foreground = luminance(getComputedStyle(heading).color)
        return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05)
      })
    })
    expect(ratios).toHaveLength(4)
    for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5)
  }
})
