import { expect, test, type Page } from '@playwright/test'
import { createDoc, replaceSource } from './helpers'

async function firstSourceLine(page: Page): Promise<number> {
  return page.locator('.cm-scroller').evaluate((scroller) => {
    const top = scroller.getBoundingClientRect().top
    const gutter = Array.from(
      scroller.closest('.cm-editor')!.querySelectorAll('.cm-gutterElement'),
    ).find(
      (element) => element.getBoundingClientRect().bottom > top && Number(element.textContent) > 0,
    )
    return Number(gutter?.textContent)
  })
}

test('preview scrolling follows blocks, reversals, endpoints, links, and replacement documents', async ({
  page,
}) => {
  await createDoc(page)
  const preview = page.frameLocator('iframe.preview-frame')
  for (const title of ['Original', 'Updated']) {
    await replaceSource(
      page,
      `= ${title}\n:toc:\n\n` +
        Array.from(
          { length: 100 },
          (_, index) => `== Section ${index + 1}\n\nParagraph ${index + 1}.\n`,
        ).join('\n'),
    )
    await expect(preview.getByRole('heading', { name: title, exact: true })).toBeVisible()
    // Yield in the parent: scripts (including animation callbacks) are
    // disabled in the preview. Each movement must reach its scroll handler.
    await page.evaluate(async () => {
      const frame = document.querySelector<HTMLIFrameElement>('.preview-frame')!
      const previewWindow = frame.contentWindow!
      for (const top of [9000, 0, 5000, 0]) {
        previewWindow.scrollTo(0, top)
        await new Promise<void>((resolve) =>
          frame.contentDocument!.addEventListener('scroll', () => resolve(), { once: true }),
        )
        await new Promise(requestAnimationFrame)
      }
      const heading = frame.contentDocument!.getElementById('_section_50')!
      previewWindow.scrollTo(0, heading.getBoundingClientRect().top + previewWindow.scrollY)
    })
    // Fractional scroll positions and font metrics can leave either adjacent
    // gutter line at the viewport edge. Require the destination within one
    // source line; the check below still rejects any subsequent preview drift.
    await expect
      .poll(async () => Math.abs((await firstSourceLine(page)) - 200))
      .toBeLessThanOrEqual(1)
    const initial = await preview.locator('body').evaluate(() => window.scrollY)
    // Let delayed scroll events and measurements run; the initiating pane
    // must not bounce to a rounded source line or keep chasing its follower.
    await page.evaluate(async () => {
      for (let index = 0; index < 12; index++) await new Promise(requestAnimationFrame)
    })
    expect(await preview.locator('body').evaluate(() => window.scrollY)).toBe(initial)

    await preview.locator('body').evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect
      .poll(() =>
        page
          .locator('.cm-scroller')
          .evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop),
      )
      .toBeLessThan(2)
    await preview.locator('body').evaluate(() => window.scrollTo(0, 0))
    await expect
      .poll(() => page.locator('.cm-scroller').evaluate((element) => element.scrollTop))
      .toBe(0)

    await preview.getByRole('link', { name: 'Section 70', exact: true }).focus()
    await preview.getByRole('link', { name: 'Section 70', exact: true }).press('Enter')
    await expect.poll(async () => Math.abs((await firstSourceLine(page)) - 281)).toBeLessThan(3)
    await expect(page.locator('iframe.preview-frame')).toHaveAttribute(
      'sandbox',
      'allow-same-origin',
    )
  }
})

test('preview wheel scrolling follows wrapped source and table rows without stealing focus', async ({
  page,
}) => {
  await createDoc(page)
  const source =
    '= Wrapped\n\n' +
    Array.from(
      { length: 70 },
      (_, index) =>
        `Paragraph ${index}. ${'Long source text wraps across the editor. '.repeat(15)}\n`,
    ).join('\n') +
    '\n[cols="1,1"]\n|===\n' +
    Array.from({ length: 60 }, (_, index) => `|Cell ${index}\n|Value ${index}\n`).join('\n') +
    '|==='
  await replaceSource(page, source)
  const preview = page.frameLocator('iframe.preview-frame')
  await expect(preview.locator('table')).toBeVisible()
  // Select the closing table delimiter backwards. Document offsets remain
  // meaningful when CodeMirror virtualizes the selected line off-screen.
  await page.keyboard.press('Shift+Home')
  const readSelection = () => page.evaluate(() => window.__asciiweave!.getSelection())
  const selection = await readSelection()
  expect(selection).toEqual({ anchor: source.length, head: source.length - 4 })
  await preview
    .locator('p')
    .nth(35)
    .evaluate((paragraph) =>
      window.scrollTo(0, paragraph.getBoundingClientRect().top + window.scrollY),
    )
  await expect.poll(async () => Math.abs((await firstSourceLine(page)) - 73)).toBeLessThan(2)
  await expect(page.locator('.cm-content')).toBeFocused()
  expect(await readSelection()).toEqual(selection)
  await preview
    .locator('tbody tr')
    .nth(30)
    .evaluate((row) => window.scrollTo(0, row.getBoundingClientRect().top + window.scrollY))
  const rowLine = source.split('\n').indexOf('|Cell 30') + 1
  await expect.poll(async () => Math.abs((await firstSourceLine(page)) - rowLine)).toBeLessThan(2)
  expect(await readSelection()).toEqual(selection)
  await preview.locator('body').evaluate(() => window.scrollTo(0, 0))
  await expect.poll(() => firstSourceLine(page)).toBe(1)
  await page.locator('iframe.preview-frame').hover()
  await page.mouse.wheel(0, 600)
  await expect.poll(() => firstSourceLine(page)).toBeGreaterThan(1)
  await expect(page.locator('.cm-content')).toBeFocused()
  expect(await readSelection()).toEqual(selection)
})
