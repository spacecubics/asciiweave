import { expect, test } from '@playwright/test'
import { createDoc, openPair, replaceSource, setSourceViaYjs } from './helpers'

const key = 'asciiweave.previewStyle.v1'

test('remembers the style and falls back after a style is removed', async ({ page }) => {
  await createDoc(page)
  const select = page.getByLabel('Preview style', { exact: true })
  await select.selectOption('test-second')
  await page.reload()
  await expect(select).toHaveValue('test-second')
  await page.evaluate((key) => localStorage.setItem(key, 'removed-style'), key)
  await page.reload()
  await expect(select).toHaveValue('default')
})

test('storage-disabled browsers can edit and switch styles', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('storage disabled')
      },
    })
  })
  await createDoc(page)
  await page.getByLabel('Preview style', { exact: true }).selectOption('test-second')
  await replaceSource(page, '== Still editing\n\nContent')
  await expect(page.frameLocator('.preview-frame').locator('h2')).toHaveCSS(
    'color',
    'rgb(60, 40, 20)',
  )
})

test('collaborators keep independent styles through remote edits and rapid switches', async ({
  browser,
  baseURL,
}) => {
  const pair = await openPair(browser, baseURL!)
  try {
    const { pageA, pageB } = pair
    await pageA.getByLabel('Preview style', { exact: true }).selectOption('test-first')
    await pageB.getByLabel('Preview style', { exact: true }).selectOption('test-second')
    for (let n = 0; n < 5; n++) {
      await setSourceViaYjs(pageA, `== Revision ${n}\n\nBody`)
      await pageA
        .getByLabel('Preview style', { exact: true })
        .selectOption(n % 2 ? 'default' : 'test-first')
    }
    for (const page of [pageA, pageB]) {
      await expect(page.frameLocator('.preview-frame').locator('h2')).toHaveText('Revision 4')
    }
    await expect(pageA.frameLocator('.preview-frame').locator('h2')).toHaveCSS(
      'color',
      'rgb(20, 40, 60)',
    )
    await expect(pageB.frameLocator('.preview-frame').locator('h2')).toHaveCSS(
      'color',
      'rgb(60, 40, 20)',
    )
  } finally {
    await pair.close()
  }
})

test('style controls fit narrow screens and remain keyboard accessible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await createDoc(page)
  const select = page.getByLabel('Preview style', { exact: true })
  await select.focus()
  await select.press('End')
  await select.press('Enter')
  await expect(select).toHaveValue('test-second')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('switching styles preserves source scroll position and does not add an undo step', async ({
  page,
}) => {
  await createDoc(page)
  await replaceSource(
    page,
    Array.from({ length: 50 }, (_, n) => `== Section ${n}\n\nParagraph ${n}.\n`).join('\n'),
  )
  const preview = page.frameLocator('.preview-frame')
  await expect(preview.getByRole('heading', { name: 'Section 49', exact: true })).toBeVisible()
  await page.locator('.cm-scroller').evaluate(async (element) => {
    element.scrollTop = element.scrollHeight / 2
    element.dispatchEvent(new Event('scroll'))
    await new Promise(requestAnimationFrame)
  })
  const visibleSection = () =>
    preview
      .locator('h2')
      .evaluateAll(
        (headings) =>
          headings.find((heading) => heading.getBoundingClientRect().top >= 0)?.textContent,
      )
  let section: string | null | undefined
  await expect
    .poll(async () => {
      section = await visibleSection()
      return section
    })
    .not.toBe('Section 0')
  for (const style of ['test-first', 'test-second', 'default']) {
    await page.getByLabel('Preview style', { exact: true }).selectOption(style)
    await expect.poll(visibleSection).toBe(section)
  }
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.locator('.cm-content')).toContainText('Untitled Document')
})

test('scripts stay blocked in every style', async ({ page }) => {
  await createDoc(page)
  await replaceSource(
    page,
    '= Isolated\n\n++++\n<script>parent.document.body.dataset.scriptRan = "yes"</script>\n++++',
  )
  for (const style of ['test-first', 'test-second', 'default']) {
    await page.getByLabel('Preview style', { exact: true }).selectOption(style)
    await expect(page.frameLocator('.preview-frame').locator('script')).toHaveCount(1)
    await expect(page.locator('body')).not.toHaveAttribute('data-script-ran', 'yes')
  }
})

test('Asciidoctor restores original language context after reload and style switches', async ({
  page,
}) => {
  await createDoc(page)
  await replaceSource(
    page,
    '= Language context\n:lang: ja\n\n== 要求根拠、仮定、TBD、およびトレーサビリティ\n\n日本語の本文。',
  )
  const preview = page.frameLocator('.preview-frame')
  const html = preview.locator('html')
  const select = page.getByLabel('Preview style', { exact: true })
  await expect(preview.locator('h2')).toContainText('要求根拠')
  await expect(html).not.toHaveAttribute('lang')
  await select.selectOption('test-first')
  await expect(html).toHaveAttribute('lang', 'ja')
  await select.selectOption('default')
  await expect(html).not.toHaveAttribute('lang')
  await select.selectOption('test-second')
  await expect(html).toHaveAttribute('lang', 'ja')
  await page.reload()
  await expect(html).toHaveAttribute('lang', 'ja')
  await select.selectOption('default')
  await page.reload()
  await expect(preview.locator('h2')).toContainText('要求根拠')
  await expect(html).not.toHaveAttribute('lang')
  for (const media of ['screen', 'print'] as const) {
    await page.emulateMedia({ media })
    await expect(preview.locator('body')).toHaveCSS(
      'font-family',
      '"Noto Serif", "DejaVu Serif", serif',
    )
    await expect(preview.locator('h2')).toHaveCSS(
      'font-family',
      '"Open Sans", "DejaVu Sans", sans-serif',
    )
  }
})
