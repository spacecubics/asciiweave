import { expect, test } from '@playwright/test'
import { createDoc, replaceSource, getText, openPair, setSourceViaYjs } from './helpers'

test('TOC follows rendered sections, navigates both panes, and refreshes after edits', async ({
  page,
}) => {
  await createDoc(page)
  const source =
    '= Navigation\n\n' +
    Array.from(
      { length: 40 },
      (_, i) => `== Section ${i + 1}\n\nText ${i}.\n\n=== 日本語 *child* ${i + 1}\n\nMore text.\n`,
    ).join('\n')
  await replaceSource(page, source)
  const toggle = page.getByRole('button', { name: 'Table of contents', exact: true })
  await expect(toggle).toBeVisible()
  const toc = page.getByRole('navigation', { name: 'Table of contents' })
  await toggle.hover()
  await expect(toc).toBeHidden()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await expect(toc).toBeVisible()
  await page.locator('.brand').hover()
  await expect(toc).toBeVisible()
  await toggle.click()
  await expect(toc).toBeHidden()
  await page.locator('.brand').hover()
  await toggle.hover()
  await expect(toc).toBeHidden()
  await toggle.click()
  await expect(toc.getByRole('link')).toHaveCount(81)
  const child = toc.getByRole('link', { name: '日本語 child 1', exact: true })
  await expect(child).toBeVisible()
  await page.getByRole('button', { name: 'Pin table of contents' }).click()
  await page.locator('.brand').hover()
  await expect(toc).toBeVisible()
  const target = toc.getByRole('link', { name: 'Section 25', exact: true })
  await target.focus()
  await target.press('Enter')
  const preview = page.frameLocator('.preview-frame')
  await expect
    .poll(() =>
      preview.locator('#_section_25').evaluate((el) => Math.abs(el.getBoundingClientRect().top)),
    )
    .toBeLessThan(2)
  await expect(target).toHaveAttribute('aria-current', 'location')
  await expect
    .poll(() => page.locator('.cm-scroller').evaluate((el) => el.scrollTop))
    .toBeGreaterThan(1000)
  expect(await getText(page)).toBe(source)
  await preview
    .locator('#_section_10')
    .evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY))
  await expect(toc.getByRole('link', { name: 'Section 10', exact: true })).toHaveAttribute(
    'aria-current',
    'location',
  )
  await page.locator('.cm-scroller').evaluate((el) => {
    el.scrollTop = 0
  })
  await expect(toc.getByRole('link', { name: 'Navigation', exact: true })).toHaveAttribute(
    'aria-current',
    'location',
  )
  await target.press('Escape')
  await expect(toc).toBeHidden()
  await expect(toggle).toBeFocused()
  await replaceSource(page, '= Updated\n\n== New section\n\nText.\n')
  await toggle.focus()
  await toggle.press('Enter')
  await expect(toc.getByRole('link')).toHaveText(['Updated', 'New section'])
  await replaceSource(page, 'Only a paragraph.')
  await expect(toggle).toBeHidden()
})

test('a short final section stays active at the preview bottom', async ({ page }) => {
  await createDoc(page)
  await setSourceViaYjs(
    page,
    '= Navigation\n\n== First\n\n' +
      'Filler paragraph.\n\n'.repeat(60) +
      '== Final\n\nShort ending.\n',
  )
  const preview = page.frameLocator('.preview-frame')
  const finalHeading = preview.getByRole('heading', { name: 'Final', exact: true })
  await expect(finalHeading).toBeVisible()
  await page.getByRole('button', { name: 'Table of contents', exact: true }).click()
  await page.getByRole('button', { name: 'Pin table of contents' }).click()
  const toc = page.getByRole('navigation', { name: 'Table of contents' })
  const finalEntry = toc.getByRole('link', { name: 'Final', exact: true })
  const firstEntry = toc.getByRole('link', { name: 'First', exact: true })

  await finalEntry.click()
  await expect(finalEntry).toHaveAttribute('aria-current', 'location')
  expect(await finalHeading.evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThan(8)
  await expect(toc.locator('[aria-current]')).toHaveCount(1)

  await preview.getByRole('heading', { name: 'First', exact: true }).evaluate((el) => {
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY)
  })
  await expect(firstEntry).toHaveAttribute('aria-current', 'location')
  await finalHeading.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect(finalEntry).toHaveAttribute('aria-current', 'location')

  await finalHeading.evaluate(() => window.scrollTo(0, 0))
  await expect(toc.getByRole('link', { name: 'Navigation', exact: true })).toHaveAttribute(
    'aria-current',
    'location',
  )
})

test('TOC remains keyboard accessible on narrow screens and ignores literal headings', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await createDoc(page)
  await replaceSource(
    page,
    '= Small\n\n[[custom]]\n== Real\n\n----\n== Literal\n----\n\n== Real\n\nLast.\n',
  )
  const toggle = page.getByRole('button', { name: 'Table of contents', exact: true })
  await expect(toggle).toBeVisible()
  await toggle.focus()
  await toggle.press('Enter')
  const toc = page.getByRole('navigation', { name: 'Table of contents' })
  await expect(toc.getByRole('link')).toHaveText(['Small', 'Real', 'Real'])
  await expect(toc.getByRole('link').nth(1)).toHaveAttribute('href', '#custom')
  await expect(toc.getByRole('link').nth(2)).toHaveAttribute('href', '#_real')
  const box = await toc.boundingBox()
  expect(box!.x + box!.width).toBeLessThanOrEqual(390)
})

test('remote edits refresh the outline without importing heading markup into the shell', async ({
  browser,
  baseURL,
}) => {
  const pair = await openPair(browser, baseURL!)
  try {
    await setSourceViaYjs(pair.pageA, '= Shared\n\n== pass:[<em>Remote title</em>]\n\nText.\n')
    const toggle = pair.pageB.getByRole('button', { name: 'Table of contents', exact: true })
    await expect(toggle).toBeVisible()
    await toggle.focus()
    await toggle.press('Enter')
    const toc = pair.pageB.getByRole('navigation', { name: 'Table of contents' })
    await expect(toc.getByRole('link')).toHaveText(['Shared', 'Remote title'])
    await expect(toc.locator('em')).toHaveCount(0)
    await setSourceViaYjs(pair.pageA, '= Shared\n\n== Replacement\n\nText.\n')
    await expect(toc.getByRole('link')).toHaveText(['Shared', 'Replacement'])
  } finally {
    await pair.close()
  }
})

test('compact heading marks navigate both panes by click and keyboard', async ({ page }) => {
  await createDoc(page)
  const source =
    '= Rail\n\n' +
    Array.from(
      { length: 40 },
      (_, index) => `== Section ${index + 1}\n\nParagraph ${index + 1}.\n`,
    ).join('\n')
  await replaceSource(page, source)
  const rail = page.getByRole('group', { name: 'Heading navigation' })
  const preview = page.frameLocator('.preview-frame')
  const section = rail.getByRole('button', { name: 'Section 20', exact: true })
  await section.hover()
  const toc = page.getByRole('navigation', { name: 'Table of contents' })
  await expect(toc).toBeHidden()
  await section.click()
  await expect(toc).toBeHidden()
  await expect(section).toHaveAttribute('aria-current', 'location')
  await expect
    .poll(() =>
      preview.locator('#_section_20').evaluate((el) => Math.abs(el.getBoundingClientRect().top)),
    )
    .toBeLessThan(2)
  await expect
    .poll(() => page.locator('.cm-scroller').evaluate((el) => el.scrollTop))
    .toBeGreaterThan(1000)
  const first = rail.getByRole('button', { name: 'Rail', exact: true })
  await first.focus()
  await first.press('Enter')
  await expect(first).toHaveAttribute('aria-current', 'location')
  await expect.poll(() => page.locator('.cm-scroller').evaluate((el) => el.scrollTop)).toBe(0)
  await section.focus()
  await section.press('Space')
  await expect(section).toHaveAttribute('aria-current', 'location')
  expect(await getText(page)).toBe(source)
})

test('the TOC opens between its rail and preview and leaves the slider usable', async ({
  page,
}) => {
  await createDoc(page)
  await replaceSource(page, '= Navigation\n\n== First\n\nText.\n\n== Second\n\nMore text.\n')
  const toggle = page.getByRole('button', { name: 'Table of contents', exact: true })
  const toc = page.getByRole('navigation', { name: 'Table of contents' })
  const divider = page.getByRole('separator', { name: 'Resize source and preview panes' })
  const previewFrame = page.locator('.preview-frame')
  const initialPreview = (await previewFrame.boundingBox())!
  const railBox = (await toggle.boundingBox())!
  expect(railBox.x + railBox.width).toBe(initialPreview.x)
  await toggle.click()
  await expect(toc).toBeVisible()
  const panelBox = (await toc.boundingBox())!
  const dividerBox = (await divider.boundingBox())!
  const openedPreview = (await previewFrame.boundingBox())!
  const sourceBox = (await page.locator('#source-pane').boundingBox())!
  expect(sourceBox.x + sourceBox.width).toBe(dividerBox.x)
  expect(dividerBox.x + dividerBox.width).toBe(railBox.x)
  expect(railBox.x + railBox.width).toBe(panelBox.x)
  expect(panelBox.x + panelBox.width).toBe(openedPreview.x)
  expect(openedPreview.width).toBeLessThan(initialPreview.width - 100)
  // Hit-testing checks the full drag target, not only its visible rule.
  expect(
    await divider.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      return [1, rect.width / 2, rect.width - 1].every(
        (x) => document.elementFromPoint(rect.left + x, rect.top + 20) === el,
      )
    }),
  ).toBe(true)
  await page.mouse.move(panelBox.x + panelBox.width - 10, panelBox.y + 20)
  await expect(toc).toBeVisible()
  await page.getByRole('button', { name: 'Pin table of contents' }).click()
  const source = page.locator('#source-pane')
  const initialWidth = (await source.boundingBox())!.width
  const docked = (await toc.boundingBox())!
  const dockedPreview = (await previewFrame.boundingBox())!
  expect(dockedPreview.width).toBeLessThan(initialPreview.width - 100)
  expect(railBox.x + railBox.width).toBe(docked.x)
  expect(docked.x + docked.width).toBe(dockedPreview.x)
  expect(dockedPreview.width).toBe(openedPreview.width)
  const pin = page.getByRole('button', { name: 'Pin table of contents' })
  await expect(pin).toHaveAttribute('aria-pressed', 'true')
  await pin.click()
  await expect(toc).toBeHidden()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(toggle).toBeFocused()
  await expect
    .poll(async () => (await previewFrame.boundingBox())!.width)
    .toBe(initialPreview.width)
  await toggle.press('Enter')
  await expect(toc).toBeVisible()
  await pin.press('Enter')
  await expect(pin).toHaveAttribute('aria-pressed', 'true')
  await pin.press('Enter')
  await expect(toc).toBeHidden()
  await expect(toggle).toBeFocused()
  await toggle.click()
  await expect(toc).toBeVisible()
  await pin.click()
  await page.mouse.move(dividerBox.x + dividerBox.width / 2, dividerBox.y + 100)
  await page.mouse.down()
  await page.mouse.move(dividerBox.x + 100, dividerBox.y + 100)
  await page.mouse.up()
  await expect
    .poll(async () => (await source.boundingBox())!.width)
    .toBeGreaterThan(initialWidth + 50)
  await expect(toc).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  const narrowPanel = (await toc.boundingBox())!
  const narrowDivider = (await divider.boundingBox())!
  expect(narrowPanel.y).toBeGreaterThanOrEqual(narrowDivider.y + narrowDivider.height)
  const narrowPreview = (await previewFrame.boundingBox())!
  expect(narrowPreview.width).toBeGreaterThan(150)
  expect(narrowPanel.x).toBe(28)
  expect(narrowPanel.x + narrowPanel.width).toBe(narrowPreview.x)
  expect(narrowPreview.x + narrowPreview.width).toBeLessThanOrEqual(390)
  const initialHeight = (await source.boundingBox())!.height
  await divider.press('ArrowDown')
  await expect.poll(async () => (await source.boundingBox())!.height).toBeGreaterThan(initialHeight)
  await pin.press('Escape')
  await expect(toc).toBeHidden()
  await expect.poll(async () => (await previewFrame.boundingBox())!.width).toBe(362)
})

test('duplicate authored IDs keep distinct TOC targets and a single active entry', async ({
  page,
}) => {
  await createDoc(page)
  const source =
    '= Duplicates\n\n[[shared]]\n== First\n\n' +
    'Filler paragraph.\n\n'.repeat(60) +
    '[[shared]]\n== Second\n\n' +
    'Tail paragraph.\n\n'.repeat(60)
  await setSourceViaYjs(page, source)
  const preview = page.frameLocator('.preview-frame')
  await expect(preview.getByRole('heading', { name: 'Second', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Table of contents', exact: true }).click()
  const toc = page.getByRole('navigation', { name: 'Table of contents' })
  const first = toc.getByRole('link', { name: 'First', exact: true })
  const second = toc.getByRole('link', { name: 'Second', exact: true })
  await expect(first).toHaveAttribute('href', '#shared')
  await expect(second).not.toHaveAttribute('href', '#shared')
  await second.click()
  await expect
    .poll(() =>
      preview
        .getByRole('heading', { name: 'Second', exact: true })
        .evaluate((el) => Math.abs(el.getBoundingClientRect().top)),
    )
    .toBeLessThan(2)
  await expect(toc.locator('[aria-current]')).toHaveCount(1)
  await expect(second).toHaveAttribute('aria-current', 'location')
  const line = source.split('\n').indexOf('== Second') + 1
  await expect
    .poll(() =>
      page.locator('.cm-scroller').evaluate((el, line) => {
        const gutter = Array.from(el.querySelectorAll('.cm-gutterElement')).find(
          (e) => e.textContent === String(line),
        )
        return gutter
          ? Math.abs(gutter.getBoundingClientRect().top - el.getBoundingClientRect().top)
          : Infinity
      }, line),
    )
    .toBeLessThan(3)
  await first.click()
  await expect(first).toHaveAttribute('aria-current', 'location')
  await expect(toc.locator('[aria-current]')).toHaveCount(1)
  await expect
    .poll(() =>
      preview.locator('#shared').evaluate((el) => Math.abs(el.getBoundingClientRect().top)),
    )
    .toBeLessThan(2)
  expect(await getText(page)).toBe(source)
})

test('pointer users can scroll the compact rail to its last heading on a narrow screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await createDoc(page)
  await setSourceViaYjs(
    page,
    '= Long rail\n\n' +
      Array.from({ length: 120 }, (_, index) => `== Section ${index + 1}\n\nText.\n`).join('\n') +
      '\n' +
      'Tail.\n\n'.repeat(30),
  )
  const rail = page.getByRole('group', { name: 'Heading navigation' })
  const last = rail.getByRole('button', { name: 'Section 120', exact: true })
  await expect(last).not.toBeInViewport()
  await rail.hover()
  await page.mouse.wheel(0, 10000)
  await expect(last).toBeInViewport()
  await last.click()
  await expect(last).toHaveAttribute('aria-current', 'location')
  await expect
    .poll(() =>
      page
        .frameLocator('.preview-frame')
        .locator('#_section_120')
        .evaluate((el) => Math.abs(el.getBoundingClientRect().top)),
    )
    .toBeLessThan(2)
})

test('active heading tracking reuses layout measurements and defers scroll-event work', async ({
  page,
}) => {
  await createDoc(page)
  await setSourceViaYjs(
    page,
    '= Cached headings\n\n' +
      Array.from({ length: 100 }, (_, index) => `== Section ${index + 1}\n\nText.\n`).join('\n'),
  )
  const preview = page.frameLocator('.preview-frame')
  await expect(preview.locator('#_section_100')).toBeVisible()
  await page.evaluate(async () => {
    const doc = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!
    await doc.fonts.ready
    for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame)
    doc.documentElement.dataset.headingReads = '0'
    for (const heading of doc.querySelectorAll('h1, h2')) {
      const original = heading.getBoundingClientRect.bind(heading)
      heading.getBoundingClientRect = () => {
        doc.documentElement.dataset.headingReads = String(
          Number(doc.documentElement.dataset.headingReads) + 1,
        )
        return original()
      }
    }
  })
  const jump = async (section: number) => {
    await preview
      .locator(`#_section_${section}`)
      .evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY))
    await expect(
      page
        .getByRole('group', { name: 'Heading navigation' })
        .getByRole('button', { name: `Section ${section}`, exact: true }),
    ).toHaveAttribute('aria-current', 'location')
  }
  await jump(80)
  const reads = async () => Number(await preview.locator('html').getAttribute('data-heading-reads'))
  const before = await reads()
  expect(
    await page.evaluate(() => {
      const doc = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!
      const before = Number(doc.documentElement.dataset.headingReads)
      for (let i = 0; i < 100; i++) doc.dispatchEvent(new Event('scroll'))
      return Number(doc.documentElement.dataset.headingReads) - before
    }),
  ).toBe(0)
  await jump(25)
  expect((await reads()) - before).toBeLessThan(10)
  const beforeLayout = await reads()
  await preview
    .locator('p')
    .first()
    .evaluate((el) => {
      el.style.paddingBottom = '1000px'
    })
  await page.evaluate(async () => {
    for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame)
  })
  await jump(35)
  expect((await reads()) - beforeLayout).toBeGreaterThanOrEqual(101)
})
