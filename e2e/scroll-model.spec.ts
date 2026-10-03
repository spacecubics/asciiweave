import { expect, test, type Page } from '@playwright/test'
import { createDoc, setSourceViaYjs } from './helpers'

async function settle(page: Page) {
  await page.evaluate(async () => {
    const doc = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!
    await doc.fonts.ready
    for (let index = 0; index < 12; index++) await new Promise(requestAnimationFrame)
  })
}

test('a document that gains overflow stays at the top', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await createDoc(page)
  await setSourceViaYjs(page, Array.from({ length: 35 }, (_, i) => `Line ${i + 1}`).join('\n'))
  await expect(page.frameLocator('.preview-frame').locator('body')).toContainText('Line 35')
  await settle(page)
  const metrics = () =>
    page.locator('.cm-scroller').evaluate((element) => ({
      top: element.scrollTop,
      overflow: element.scrollHeight - element.clientHeight,
    }))
  expect(await metrics()).toEqual({ top: 0, overflow: 0 })
  await page.setViewportSize({ width: 1280, height: 400 })
  await settle(page)
  expect((await metrics()).overflow).toBeGreaterThan(100)
  expect((await metrics()).top).toBe(0)
})

test('source without overflow does not request preview bottom alignment', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await createDoc(page)
  await setSourceViaYjs(
    page,
    '== Start\n\n++++\n<div style="height: 2000px">Tall preview content</div>\n++++\n\n== End\n\nEnd.',
  )
  const preview = page.frameLocator('.preview-frame').locator('body')
  await expect(preview).toContainText('Tall preview content')
  await settle(page)
  const overflow = await page.locator('.cm-scroller').evaluate((scroller) => {
    scroller.dispatchEvent(new Event('scroll'))
    return scroller.scrollHeight - scroller.clientHeight
  })
  expect(overflow).toBe(0)
  await settle(page)
  const metrics = await preview.evaluate((body) => {
    const scroller = body.ownerDocument.scrollingElement!
    return { top: scroller.scrollTop, overflow: scroller.scrollHeight - scroller.clientHeight }
  })
  expect(metrics.overflow).toBeGreaterThan(1000)
  expect(metrics.top).toBeLessThan(100)
})
