import { expect, test, type Page } from '@playwright/test'
import { createDoc, getText, setSourceViaYjs } from './helpers'

const before =
  '== Earlier section\n\n' +
  Array.from(
    { length: 12 },
    (_, i) => `Earlier paragraph ${i}. ` + 'Earlier content. '.repeat(30),
  ).join('\n\n') +
  '\n\n'
const reading =
  '== Reading section\n\nNeighbor paragraph. ' +
  'Nearby material. '.repeat(100) +
  '\n\n' +
  Array.from(
    { length: 180 },
    (_, i) => `Read${String(i).padStart(4, '0')} alpha bravo charlie delta echo foxtrot.`,
  ).join('\n')
const after =
  '\n\n== Later section\n\n' +
  Array.from(
    { length: 12 },
    (_, i) => `Following paragraph ${i}. ` + 'Later content. '.repeat(30),
  ).join('\n\n')

async function settle(page: Page) {
  await page.evaluate(async () => {
    const doc = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!
    await doc.fonts.ready
    for (let i = 0; i < 20; i++) await new Promise(requestAnimationFrame)
  })
}

async function markerTop(page: Page, marker: string, scroll = false) {
  return page
    .frameLocator('.preview-frame')
    .locator('body')
    .evaluate(
      (body, { marker, scroll }) => {
        const doc = body.ownerDocument
        const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT)
        let node: Node | null
        while ((node = walker.nextNode())) {
          const at = node.textContent!.indexOf(marker)
          if (at < 0) continue
          const range = doc.createRange()
          range.setStart(node, at)
          range.setEnd(node, at + marker.length)
          if (scroll) doc.scrollingElement!.scrollTop += range.getBoundingClientRect().top - 8
          return range.getBoundingClientRect().top
        }
        return null
      },
      { marker, scroll },
    )
}

for (const scenario of [
  'insert-above',
  'listing',
  'comment',
  'merge',
  'heading',
  'table',
  'navigate',
] as const) {
  test(`preview preserves reading position through ${scenario}`, async ({ page, browser }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const url = await createDoc(page)
    const source =
      before +
      (scenario === 'table' ? '|===\n|First |Second\n|Third |Fourth\n|===\n\n' : '') +
      reading +
      after
    await setSourceViaYjs(page, source)
    await expect(page.frameLocator('.preview-frame').locator('h2').last()).toHaveText(
      'Later section',
    )
    const context = await browser.newContext()
    try {
      const remote = await context.newPage()
      await remote.goto(url)
      await expect.poll(() => getText(remote)).toBe(source)
      const marker = scenario === 'heading' ? 'Reading section' : 'Read0072'
      await settle(page)
      await markerTop(page, marker, true)
      await settle(page)
      const original = (await markerTop(page, marker))!
      let expected = source
      const history: string[] = []
      async function change(find: string, insert = '', remove = 0) {
        await remote.waitForTimeout(550)
        const old = await page.locator('.preview-frame').getAttribute('srcdoc')
        const at = expected.indexOf(find)
        expect(at).toBeGreaterThanOrEqual(0)
        history.push(expected)
        expected = expected.slice(0, at) + insert + expected.slice(at + remove)
        await remote.evaluate(
          ({ at, insert, remove }) => {
            const h = window.__asciiweave!
            h.ydoc.transact(() => {
              if (remove) h.ytext.delete(at, remove)
              if (insert) h.ytext.insert(at, insert)
            })
          },
          { at, insert, remove },
        )
        await expect.poll(() => getText(page)).toBe(expected)
        await expect(page.locator('.preview-frame')).not.toHaveAttribute('srcdoc', old!)
        await settle(page)
      }
      async function undo() {
        const old = await page.locator('.preview-frame').getAttribute('srcdoc')
        expected = history.pop()!
        await remote.locator('.cm-content').focus()
        await remote.keyboard.press('ControlOrMeta+z')
        await expect.poll(() => getText(page)).toBe(expected)
        await expect(page.locator('.preview-frame')).not.toHaveAttribute('srcdoc', old!)
        await settle(page)
      }
      let destination = marker
      let desired = original
      if (scenario === 'insert-above') {
        await change('== Earlier section', 'Inserted paragraph.\n\n')
        expect(Math.abs((await markerTop(page, marker))! - original)).toBeLessThan(3)
      } else if (scenario === 'listing' || scenario === 'comment' || scenario === 'navigate') {
        const delimiter = scenario === 'listing' ? '----' : '////'
        await change('== Reading section', delimiter + '\n')
        if (scenario === 'listing')
          expect(Math.abs((await markerTop(page, marker))! - original)).toBeLessThan(200)
        else expect(await markerTop(page, marker)).toBeNull()
        await change('\n\n== Later section', '\n' + delimiter)
        if (scenario === 'navigate') {
          destination = 'Later section'
          await markerTop(page, destination, true)
          await settle(page)
          desired = (await markerTop(page, destination))!
        }
      } else if (scenario === 'merge') {
        await change('\n\nRead0000', '', 1)
      } else if (scenario === 'heading') {
        await change('== Reading section', '', 3)
      } else {
        await change('|===\n\n== Reading section', '', 4)
        expect(Math.abs((await markerTop(page, marker))! - original)).toBeLessThan(300)
      }
      while (history.length) await undo()
      expect(Math.abs((await markerTop(page, destination))! - desired)).toBeLessThan(3)
      expect(await getText(page)).toBe(source)
    } finally {
      await context.close()
    }
  })
}

for (const pane of ['preview', 'source'] as const) {
  test(`${pane} retains progress in a long final line through a remote edit above it`, async ({
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
      if (pane === 'source') {
        await page.locator('.cm-scroller').evaluate((el) => {
          el.scrollTop = el.scrollHeight
        })
        await settle(page)
      }
      const target =
        pane === 'preview'
          ? page.frameLocator('.preview-frame').locator('.paragraph').last()
          : page.locator('.cm-line').filter({ hasText: 'Reading target.' })
      await target.evaluate((el, pane) => {
        const scroller =
          pane === 'preview' ? el.ownerDocument.scrollingElement! : el.closest('.cm-scroller')!
        const top = pane === 'preview' ? 0 : scroller.getBoundingClientRect().top
        const rect = el.getBoundingClientRect()
        scroller.scrollTop += rect.top - top + rect.height * 0.4
      }, pane)
      await settle(page)
      const progress = () =>
        target.evaluate((el, pane) => {
          const top =
            pane === 'preview' ? 0 : el.closest('.cm-scroller')!.getBoundingClientRect().top
          const rect = el.getBoundingClientRect()
          return (top - rect.top) / rect.height
        }, pane)
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
}

test('source line-height corrections preserve the preview reading position', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await createDoc(page)
  await setSourceViaYjs(page, before + reading + after)
  await expect(page.frameLocator('.preview-frame').locator('h2').last()).toHaveText('Later section')
  await settle(page)
  await markerTop(page, 'Later section', true)
  await settle(page)
  const original = (await markerTop(page, 'Later section'))!
  for (const lineHeight of ['2', '1.5', '3']) {
    const sourceTop = await page.locator('.cm-scroller').evaluate((el) => el.scrollTop)
    await page.locator('.cm-content').evaluate((el, value) => {
      el.style.lineHeight = value
    }, lineHeight)
    await settle(page)
    expect(await page.locator('.cm-scroller').evaluate((el) => el.scrollTop)).not.toBe(sourceTop)
    expect(Math.abs((await markerTop(page, 'Later section'))! - original)).toBeLessThan(3)
  }
})

for (const syntax of ['list', 'comments', 'conditional'] as const) {
  test(`preview navigation follows the complete ${syntax} source extent`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await createDoc(page)
    const lines = Array.from({ length: 120 }, (_, index) => {
      const text = `Target${String(index).padStart(4, '0')} reading text.`
      if (syntax === 'list') return '* ' + text
      if (syntax === 'comments') return text + ' +\n// omitted comment'
      return text + ' +\nifdef::missing[]\nOmitted text.\nendif::[]'
    })
    const source = '== Start\n\n' + lines.join('\n') + after
    await setSourceViaYjs(page, source)
    await expect(page.frameLocator('.preview-frame').locator('body')).toContainText('Target0119')
    await settle(page)
    await markerTop(page, 'Target0060', true)
    await settle(page)
    expect(Math.abs((await markerTop(page, 'Target0060'))! - 8)).toBeLessThan(1)
    const firstSourceLine = await page.locator('.cm-scroller').evaluate((scroller) => {
      const top = scroller.getBoundingClientRect().top
      return Number(
        Array.from(scroller.closest('.cm-editor')!.querySelectorAll('.cm-gutterElement')).find(
          (element) =>
            element.getBoundingClientRect().bottom > top && Number(element.textContent) > 0,
        )?.textContent,
      )
    })
    const expectedLine = source.slice(0, source.indexOf('Target0060')).split('\n').length
    expect(Math.abs(firstSourceLine - expectedLine)).toBeLessThan(6)
  })
}

test('source navigation skips passthrough anchors absent from the preview HTML', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await createDoc(page)
  const source =
    '== Start\n\nBefore paragraph.\n\n++++\n' +
    Array.from({ length: 100 }, (_, index) => `<p>Raw paragraph ${index}.</p>`).join('\n') +
    '\n++++\n\n== End\n\nEnd.'
  await setSourceViaYjs(page, source)
  const preview = page.frameLocator('.preview-frame')
  await expect(preview.locator('body')).toContainText('Raw paragraph 99.')
  await settle(page)
  await page.locator('.cm-scroller').evaluate((scroller) => {
    scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * 0.5
  })
  await settle(page)
  expect(await preview.locator('html').evaluate((el) => el.scrollTop)).toBeGreaterThan(500)
})

test('a list retains its reading region when a remote edit turns it into a listing', async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const url = await createDoc(page)
  const list = Array.from(
    { length: 120 },
    (_, index) => `* Item${String(index).padStart(4, '0')} reading text.`,
  ).join('\n')
  const source = before + list + after
  await setSourceViaYjs(page, source)
  await expect(page.frameLocator('.preview-frame').locator('body')).toContainText('Item0119')
  const context = await browser.newContext()
  try {
    const remote = await context.newPage()
    await remote.goto(url)
    await expect.poll(() => getText(remote)).toBe(source)
    await settle(page)
    await markerTop(page, 'Item0060', true)
    await settle(page)
    const original = (await markerTop(page, 'Item0060'))!
    await remote.evaluate(
      ({ start, end }) => {
        const h = window.__asciiweave!
        h.ydoc.transact(() => {
          h.ytext.insert(end, '\n----')
          h.ytext.insert(start, '----\n')
        })
      },
      { start: before.length, end: before.length + list.length },
    )
    await expect(page.frameLocator('.preview-frame').locator('.listingblock')).toContainText(
      'Item0060',
    )
    await settle(page)
    expect(Math.abs((await markerTop(page, 'Item0060'))! - original)).toBeLessThan(60)
    await remote.locator('.cm-content').focus()
    await remote.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => getText(page)).toBe(source)
    await expect(page.frameLocator('.preview-frame').locator('.listingblock')).toHaveCount(0)
    await settle(page)
    expect(Math.abs((await markerTop(page, 'Item0060'))! - original)).toBeLessThan(3)
  } finally {
    await context.close()
  }
})
