import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { createDoc, getText, replaceSource } from './helpers'

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
    await page.getByLabel('Preview style', { exact: true }).selectOption('space-cubics')
    expect(await fonts()).toEqual(originalFonts)
    await expect(preview.locator('html')).toHaveAttribute('lang', 'ja')
    await page.emulateMedia({ media: 'print' })
    for (const style of ['space-cubics']) {
      await page.getByLabel('Preview style', { exact: true }).selectOption(style)
      expect(await fonts()).toEqual(originalFonts)
    }
  } finally {
    await cdp.detach()
  }
})
