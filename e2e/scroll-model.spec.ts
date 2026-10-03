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

for (const measured of [false, true]) {
  for (const latest of ['source', 'preview'] as const) {
    for (const reported of [false, true]) {
      test(`${reported ? 'reported' : 'unreported'} ${latest} navigation wins before a divider resize with ${measured ? 'measured' : 'estimated'} source heights`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: 1280, height: 900 })
        await createDoc(page)
        const source = Array.from(
          { length: 60 },
          (_, i) => `== Topic ${i + 1}\n\nText for topic ${i + 1}.\n`,
        ).join('\n')
        await setSourceViaYjs(page, source)
        const preview = page.frameLocator('.preview-frame')
        await expect(preview.locator('h2')).toHaveCount(60)
        await settle(page)
        let sourceTop = 2200
        if (measured) {
          await page.locator('.cm-scroller').evaluate((scroller) => {
            scroller.scrollTop = 2200
          })
          await settle(page)
          sourceTop = await page.locator('.cm-scroller').evaluate((scroller) => {
            const line = Array.from(
              scroller.closest('.cm-editor')!.querySelectorAll('.cm-gutterElement'),
            ).find((line) => line.textContent === '121')!
            return (
              scroller.scrollTop +
              line.getBoundingClientRect().top -
              scroller.getBoundingClientRect().top +
              1
            )
          })
          await page.locator('.cm-scroller').evaluate((scroller) => {
            scroller.scrollTop = 0
          })
          await settle(page)
        }
        await page.evaluate(
          ({ latest, reported, sourceTop }) => {
            const doc =
              document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!
            const scroller = document.querySelector('.cm-scroller')!
            const moveSource = () => {
              scroller.scrollTop = sourceTop
            }
            const movePreview = () => {
              doc.scrollingElement!.scrollTop += doc
                .getElementById('_topic_10')!
                .getBoundingClientRect().top
            }
            if (latest === 'source') {
              movePreview()
              doc.dispatchEvent(new Event('scroll'))
              moveSource()
              if (reported) scroller.dispatchEvent(new Event('scroll'))
            } else {
              moveSource()
              scroller.dispatchEvent(new Event('scroll'))
              movePreview()
              if (reported) doc.dispatchEvent(new Event('scroll'))
            }
            document
              .querySelector('#pane-resizer')!
              .dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
          },
          { latest, reported, sourceTop },
        )
        await settle(page)
        const heading = latest === 'source' ? '_topic_31' : '_topic_10'
        await expect
          .poll(() =>
            preview
              .locator(`#${heading}`)
              .evaluate((element) => Math.abs(element.getBoundingClientRect().top)),
          )
          .toBeLessThan(!measured && latest === 'source' ? 50 : 2)
        const targetLine = latest === 'source' ? 121 : 37
        const firstLine = await page.locator('.cm-scroller').evaluate((scroller) => {
          const top = scroller.getBoundingClientRect().top
          return Number(
            Array.from(scroller.closest('.cm-editor')!.querySelectorAll('.cm-gutterElement')).find(
              (line) => line.getBoundingClientRect().bottom > top && Number(line.textContent) > 0,
            )?.textContent,
          )
        })
        // An estimated jump can move by a line while CodeMirror measures it.
        expect(Math.abs(firstLine - targetLine)).toBeLessThanOrEqual(measured ? 1 : 2)
      })
    }
  }
}

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
