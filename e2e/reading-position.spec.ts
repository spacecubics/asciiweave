import { expect, test, type Page } from '@playwright/test'
import { createDoc, getText, setSourceViaYjs } from './helpers'

const before =
  '== Earlier section\n\n' +
  Array.from(
    { length: 12 },
    (_, i) => `Earlier paragraph ${i}. ` + 'Earlier content. '.repeat(30),
  ).join('\n\n') +
  '\n\n'
async function settle(page: Page) {
  await page.evaluate(async () => {
    const doc = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!
    await doc.fonts.ready
    for (let i = 0; i < 20; i++) await new Promise(requestAnimationFrame)
  })
}

test('source retains progress in a long final line through a remote edit above it', async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const url = await createDoc(page)
  const source = before + 'Reading target. ' + 'Words for the final long paragraph. '.repeat(450)
  await setSourceViaYjs(page, source)
  await expect(page.frameLocator('.preview-frame').locator('.paragraph').last()).toContainText(
    'Reading target.',
  )
  const context = await browser.newContext()
  try {
    const remote = await context.newPage()
    await remote.goto(url)
    await expect.poll(() => getText(remote)).toBe(source)
    await settle(page)
    await page.locator('.cm-scroller').evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await settle(page)
    const target = page.locator('.cm-line').filter({ hasText: 'Reading target.' })
    await target.evaluate((el) => {
      const scroller = el.closest('.cm-scroller')!
      const top = scroller.getBoundingClientRect().top
      const rect = el.getBoundingClientRect()
      scroller.scrollTop += rect.top - top + rect.height * 0.4
    })
    await settle(page)
    const progress = () =>
      target.evaluate((el) => {
        const top = el.closest('.cm-scroller')!.getBoundingClientRect().top
        const rect = el.getBoundingClientRect()
        return (top - rect.top) / rect.height
      })
    expect(await progress()).toBeCloseTo(0.4, 2)
    const original = await page.locator('.preview-frame').getAttribute('srcdoc')
    await remote.evaluate(() =>
      window.__asciiweave!.ytext.insert(0, 'Inserted remote paragraph.\n\n'),
    )
    await expect(page.locator('.preview-frame')).not.toHaveAttribute('srcdoc', original!)
    await settle(page)
    expect(await progress()).toBeCloseTo(0.4, 2)
    const updated = await page.locator('.preview-frame').getAttribute('srcdoc')
    await remote.locator('.cm-content').focus()
    await remote.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => getText(page)).toBe(source)
    await expect(page.locator('.preview-frame')).not.toHaveAttribute('srcdoc', updated!)
    await settle(page)
    expect(await progress()).toBeCloseTo(0.4, 2)
  } finally {
    await context.close()
  }
})
