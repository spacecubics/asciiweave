import { expect, test, type Page } from '@playwright/test'
import {
  createDoc,
  firstSourceLine,
  getText,
  openPair,
  replaceSource,
  scrollSourceToLine,
  setSourceViaYjs,
} from './helpers'

const modes = ['Edit', 'Both', 'View'] as const
type Mode = (typeof modes)[number]
type Pane = 'source' | 'preview'
type Position = 'start' | 'middle' | 'end'

function makeDocument(sectionCount: number) {
  const sections = Array.from({ length: sectionCount }, (_, index) => ({
    id: `_topic_${index + 1}`,
    label: `Topic ${index + 1}`,
  }))
  const source = sections.map(({ label }) => `== ${label}\n\nText for ${label}.\n`).join('\n')
  const middle = sections[Math.floor(sections.length / 2)]
  return {
    source,
    sections,
    middle,
    middleLine: middle ? source.split('\n').indexOf(`== ${middle.label}`) + 1 : 1,
  }
}

async function settleLayout(page: Page) {
  await page.evaluate(async () => {
    for (let index = 0; index < 12; index++) await new Promise(requestAnimationFrame)
  })
}

async function expectMode(page: Page, mode: Mode) {
  for (const option of modes) {
    await expect(page.getByRole('button', { name: option, exact: true })).toHaveAttribute(
      'aria-pressed',
      String(option === mode),
    )
  }
  await expect(page.locator('#source-pane')).toBeVisible({ visible: mode !== 'View' })
  await expect(page.locator('#preview-pane')).toBeVisible({ visible: mode !== 'Edit' })
  await expect(page.locator('#pane-resizer')).toBeVisible({ visible: mode === 'Both' })
}

async function wrappedProgress(page: Page): Promise<number> {
  return page.locator('.cm-scroller').evaluate((scroller) => {
    const paragraph = Array.from(scroller.querySelectorAll('.cm-line')).find((line) =>
      line.textContent?.startsWith('Wrapped paragraph'),
    )!
    const bounds = paragraph.getBoundingClientRect()
    return (scroller.getBoundingClientRect().top - bounds.top) / bounds.height
  })
}

async function scrollPane(
  page: Page,
  pane: Pane,
  position: Position,
  fixture: ReturnType<typeof makeDocument>,
) {
  if (pane === 'source' && position === 'middle') {
    await scrollSourceToLine(page, fixture.middleLine)
  } else {
    await page.evaluate(
      ({ pane, position, id }) => {
        const doc = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!
        const scroller =
          pane === 'source' ? document.querySelector('.cm-scroller')! : doc.scrollingElement!
        scroller.scrollTop =
          position === 'end'
            ? scroller.scrollHeight
            : position === 'middle'
              ? scroller.scrollTop + doc.getElementById(id!)!.getBoundingClientRect().top
              : 0
      },
      { pane, position, id: fixture.middle?.id },
    )
  }
  await settleLayout(page)
}

async function expectPosition(
  page: Page,
  mode: Mode,
  position: Position,
  fixture: ReturnType<typeof makeDocument>,
) {
  if (mode !== 'View') {
    if (position === 'end') {
      await expect
        .poll(() =>
          page
            .locator('.cm-scroller')
            .evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop),
        )
        .toBeLessThan(2)
    } else {
      await expect
        .poll(async () =>
          Math.abs((await firstSourceLine(page)) - (position === 'start' ? 1 : fixture.middleLine)),
        )
        .toBeLessThanOrEqual(1)
    }
  }
  if (mode !== 'Edit') {
    const preview = page.frameLocator('iframe.preview-frame')
    if (position === 'end') {
      await expect
        .poll(() =>
          preview
            .locator('html')
            .evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop),
        )
        .toBeLessThan(2)
    } else if (position === 'middle') {
      await expect
        .poll(() =>
          preview
            .locator(`[id="${fixture.middle!.id}"]`)
            .evaluate((element) => Math.abs(element.getBoundingClientRect().top)),
        )
        .toBeLessThan(2)
    } else {
      await expect
        .poll(() =>
          preview.locator('html').evaluate((element) => {
            const heading = element.querySelector('h2')
            return heading ? Math.max(0, -heading.getBoundingClientRect().top) : element.scrollTop
          }),
        )
        .toBeLessThan(2)
    }
  }
}

for (const width of [1280, 390]) {
  for (const placement of ['first', 'middle', 'last'] as const) {
    test(`layout switching preserves wrapped paragraph progress on the ${placement} line at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 })
      await createDoc(page)
      const paragraph = 'Wrapped paragraph with enough words to fill many visual rows. '.repeat(300)
      const source = [
        ...(placement === 'first' ? [] : ['== Before', '']),
        paragraph,
        ...(placement === 'last' ? [] : ['', '== After', '', 'Closing text.']),
      ].join('\n')
      await setSourceViaYjs(page, source)
      await expect(page.frameLocator('iframe.preview-frame').locator('body')).toContainText(
        'Wrapped paragraph',
      )
      await settleLayout(page)
      for (const to of ['Edit', 'Both'] as const) {
        await page.locator('.cm-scroller').evaluate((scroller) => {
          const paragraph = Array.from(scroller.querySelectorAll('.cm-line')).find((line) =>
            line.textContent?.startsWith('Wrapped paragraph'),
          )!
          const bounds = paragraph.getBoundingClientRect()
          scroller.scrollTop +=
            bounds.top - scroller.getBoundingClientRect().top + bounds.height * 0.4
        })
        await settleLayout(page)
        expect(await wrappedProgress(page)).toBeCloseTo(0.4, 2)
        await page.getByRole('button', { name: to, exact: true }).click()
        await settleLayout(page)
        await expect.poll(() => wrappedProgress(page)).toBeCloseTo(0.4, 2)
      }
    })
  }

  for (const queued of [false, true]) {
    for (const from of ['View', 'Both'] as const) {
      test(`layout switching captures ${queued ? 'queued' : 'unreported'} preview scrolling from ${from} at ${width}px`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 })
        await createDoc(page)
        const fixture = makeDocument(60)
        await setSourceViaYjs(page, fixture.source)
        await expect(page.frameLocator('iframe.preview-frame').locator('h2')).toHaveCount(60)
        for (const to of ['Edit', from === 'View' ? 'Both' : 'View'] as const) {
          await page.getByRole('button', { name: from, exact: true }).click()
          await settleLayout(page)
          await scrollPane(page, 'preview', 'start', fixture)
          await page.evaluate(
            ({ id, to, queued }) => {
              const doc =
                document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!
              doc.scrollingElement!.scrollTop += doc.getElementById(id)!.getBoundingClientRect().top
              // Switch before the browser can process the scroll on the next frame.
              if (queued) doc.dispatchEvent(new Event('scroll'))
              document
                .querySelector<HTMLButtonElement>(`button[data-layout="${to.toLowerCase()}"]`)!
                .click()
            },
            { id: fixture.middle!.id, to, queued },
          )
          await settleLayout(page)
          await expectPosition(page, to, 'middle', fixture)
          await page.getByRole('button', { name: 'Both', exact: true }).click()
          await settleLayout(page)
          await expectPosition(page, 'Both', 'middle', fixture)
        }
      })
    }
  }

  test(`layout switching preserves editing and the divider at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await createDoc(page)
    const controls = page.getByRole('group', { name: 'Editor layout' })
    const edit = controls.getByRole('button', { name: 'Edit', exact: true })
    const both = controls.getByRole('button', { name: 'Both', exact: true })
    const view = controls.getByRole('button', { name: 'View', exact: true })
    const source = page.locator('#source-pane')
    const preview = page.locator('#preview-pane')
    const divider = page.getByRole('separator')
    const style = page.getByLabel('Preview style')
    await expect(controls.getByRole('button')).toHaveText(['Edit', 'Both', 'View'])
    await expect(both).toHaveAttribute('aria-pressed', 'true')
    await expect(style).toBeEnabled()
    await style.selectOption('git-docs')
    await divider.press(width > 800 ? 'ArrowRight' : 'ArrowDown')
    await expect(divider).toHaveAttribute('aria-valuenow', '55')

    await edit.focus()
    await edit.press('Enter')
    await expect(edit).toBeFocused()
    await expect(edit).toHaveAttribute('aria-pressed', 'true')
    await expect(both).toHaveAttribute('aria-pressed', 'false')
    await expect(source).toBeVisible()
    await expect(preview).toBeHidden()
    await expect(divider).toBeHidden()
    await expect(style).toBeDisabled()
    await expect(style).toHaveValue('git-docs')
    expect(await source.boundingBox()).toEqual(await page.locator('.panes').boundingBox())
    await replaceSource(page, '= Layout test\n\nOriginal text.')
    const selection = await page.evaluate(() => window.__asciiweave!.getSelection())

    await view.click()
    await expect(view).toHaveAttribute('aria-pressed', 'true')
    await expect(edit).toHaveAttribute('aria-pressed', 'false')
    await expect(source).toBeHidden()
    await expect(preview).toBeVisible()
    await expect(style).toBeEnabled()
    await expect(style).toHaveValue('git-docs')
    expect(await preview.boundingBox()).toEqual(await page.locator('.panes').boundingBox())
    await expect(page.frameLocator('iframe.preview-frame').locator('body')).toContainText(
      'Original text.',
    )
    await expect(divider).toBeHidden()
    await expect(page.getByRole('button', { name: 'Table of contents', exact: true })).toBeVisible()

    await view.press('Shift+Tab')
    await expect(both).toBeFocused()
    await both.press('Space')
    await expect(both).toHaveAttribute('aria-pressed', 'true')
    await expect(view).toHaveAttribute('aria-pressed', 'false')
    await expect(style).toBeEnabled()
    await expect(style).toHaveValue('git-docs')
    await expect(source).toBeVisible()
    await expect(preview).toBeVisible()
    await expect(divider).toBeVisible()
    await expect(divider).toHaveAttribute('aria-valuenow', '55')
    expect(await page.evaluate(() => window.__asciiweave!.getSelection())).toEqual(selection)
    await page.locator('.cm-content').focus()
    await page.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => getText(page)).toContain('Untitled Document')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
  })
}

for (const width of [1280, 390]) {
  for (const documentSize of ['empty', 'short', 'long'] as const) {
    for (const from of modes) {
      for (const to of modes) {
        test(`${from} to ${to} preserves ${documentSize} document state at ${width}px`, async ({
          page,
        }) => {
          await page.setViewportSize({ width, height: 900 })
          await createDoc(page)
          const fixture = makeDocument(
            documentSize === 'empty' ? 0 : documentSize === 'short' ? 1 : 37,
          )
          await replaceSource(page, fixture.source)
          const preview = page.frameLocator('iframe.preview-frame')
          await expect(preview.locator('h2')).toHaveCount(fixture.sections.length)
          const selection = await page.evaluate(() => window.__asciiweave!.getSelection())
          const origins: Pane[] =
            from === 'Both' ? ['source', 'preview'] : [from === 'Edit' ? 'source' : 'preview']
          const positions: Position[] =
            documentSize === 'long' ? ['middle', 'end', 'start'] : ['start']
          for (const origin of origins) {
            for (const position of positions) {
              await test.step(`${origin} at ${position}`, async () => {
                await page.getByRole('button', { name: from, exact: true }).click()
                await settleLayout(page)
                await expectMode(page, from)
                await scrollPane(page, origin, position, fixture)
                await expectPosition(page, from, position, fixture)
                const button = page.getByRole('button', { name: to, exact: true })
                await button.click()
                await expectMode(page, to)
                await settleLayout(page)
                await expectPosition(page, to, position, fixture)
                await expect(button).toBeFocused()
                expect(await page.evaluate(() => window.__asciiweave!.getSelection())).toEqual(
                  selection,
                )
                expect(await getText(page)).toBe(fixture.source)
                const overflow = await page.evaluate(() => {
                  const source = document.querySelector('.cm-scroller')!
                  const preview =
                    document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!
                      .scrollingElement!
                  return [
                    ...(!document.querySelector<HTMLElement>('#source-pane')!.hidden
                      ? [source]
                      : []),
                    ...(!document.querySelector<HTMLElement>('#preview-pane')!.hidden
                      ? [preview]
                      : []),
                  ].map((element) => element.scrollHeight - element.clientHeight)
                })
                for (const height of overflow) {
                  if (documentSize === 'long') expect(height).toBeGreaterThan(0)
                  else expect(height).toBeLessThanOrEqual(1)
                }
              })
            }
          }
        })
      }
    }
  }
}

test('TOC navigation in View preserves the reading position when returning to Both', async ({
  page,
}) => {
  await createDoc(page)
  const fixture = makeDocument(29)
  await replaceSource(page, fixture.source)
  const preview = page.frameLocator('iframe.preview-frame')
  await expect(preview.locator('h2')).toHaveCount(fixture.sections.length)
  await page.getByRole('button', { name: 'View', exact: true }).click()
  await page.getByRole('button', { name: 'Table of contents', exact: true }).click()
  await page.getByRole('link', { name: fixture.middle!.label, exact: true }).click()
  const heading = preview.getByRole('heading', { name: fixture.middle!.label, exact: true })
  await expect
    .poll(() => heading.evaluate((element) => Math.abs(element.getBoundingClientRect().top)))
    .toBeLessThan(2)
  await page.getByRole('button', { name: 'Both', exact: true }).click()
  const sectionLine = fixture.middleLine
  await expect
    .poll(async () => Math.abs((await firstSourceLine(page)) - sectionLine))
    .toBeLessThanOrEqual(1)
  await expect
    .poll(() => heading.evaluate((element) => Math.abs(element.getBoundingClientRect().top)))
    .toBeLessThan(2)
})

test('view mode receives collaborator edits without changing their layout', async ({
  browser,
  baseURL,
}) => {
  const pair = await openPair(browser, baseURL!)
  try {
    await pair.pageB.getByRole('button', { name: 'View', exact: true }).click()
    await pair.pageA.getByRole('button', { name: 'Edit', exact: true }).click()
    await replaceSource(pair.pageA, '= Shared document\n\nLive update.')
    await expect(pair.pageB.frameLocator('iframe.preview-frame').locator('body')).toContainText(
      'Live update.',
    )
    await expect(pair.pageB.locator('#source-pane')).toBeHidden()
    await expect(pair.pageA.locator('#preview-pane')).toBeHidden()
    await pair.pageB.getByRole('button', { name: 'Both', exact: true }).click()
    await expect(pair.pageB.locator('.cm-content')).toContainText('Live update.')
    await expect(pair.pageA.locator('#preview-pane')).toBeHidden()
  } finally {
    await pair.close()
  }
})

for (const width of [1280, 390]) {
  for (const queued of [false, true]) {
    for (const from of ['Edit', 'Both'] as const) {
      test(`switching from ${from} captures ${queued ? 'queued' : 'unreported'} source scrolling at ${width}px`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 })
        await createDoc(page)
        const fixture = makeDocument(60)
        await setSourceViaYjs(page, fixture.source)
        await expect(page.frameLocator('.preview-frame').locator('h2')).toHaveCount(60)
        await page.getByRole('button', { name: from, exact: true }).click()
        await settleLayout(page)
        await scrollPane(page, 'source', 'middle', fixture)
        const target = await page.locator('.cm-scroller').evaluate((el) => el.scrollTop)
        await scrollPane(page, 'source', 'start', fixture)
        await page.evaluate(
          ({ target, queued }) => {
            const scroller = document.querySelector('.cm-scroller')!
            scroller.scrollTop = target
            if (queued) scroller.dispatchEvent(new Event('scroll'))
            document.querySelector<HTMLButtonElement>('[data-layout="view"]')!.click()
          },
          { target, queued },
        )
        await settleLayout(page)
        await expectPosition(page, 'View', 'middle', fixture)
        await page.getByRole('button', { name: 'Both', exact: true }).click()
        await settleLayout(page)
        await expectPosition(page, 'Both', 'middle', fixture)
      })
    }
  }

  test(`the preview retains progress in its final paragraph through mode changes at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await createDoc(page)
    await setSourceViaYjs(page, '== Start\n\n' + 'Long paragraph for reading. '.repeat(800))
    const paragraph = page.frameLocator('.preview-frame').locator('.paragraph').last()
    await expect(paragraph).toContainText('Long paragraph')
    await page.getByRole('button', { name: 'View', exact: true }).click()
    await settleLayout(page)
    await paragraph.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      document.scrollingElement!.scrollTop += bounds.top + bounds.height * 0.4
    })
    await settleLayout(page)
    const progress = () =>
      paragraph.evaluate((el) => {
        const bounds = el.getBoundingClientRect()
        return -bounds.top / bounds.height
      })
    expect(await progress()).toBeCloseTo(0.4, 2)
    for (const mode of ['Both', 'View', 'Edit', 'View', 'Both'] as const) {
      await page.getByRole('button', { name: mode, exact: true }).click()
      await settleLayout(page)
      if (mode !== 'Edit') expect(await progress()).toBeCloseTo(0.4, 2)
    }
  })

  test(`content that fits in Edit stays at the top when Both introduces overflow at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await createDoc(page)
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    const source =
      width > 800
        ? Array.from({ length: 30 }, (_, i) => `Line ${i} ` + 'text '.repeat(24)).join('\n')
        : Array.from({ length: 30 }, (_, i) => `Line ${i}`).join('\n')
    await setSourceViaYjs(page, source)
    await settleLayout(page)
    const metrics = () =>
      page.locator('.cm-scroller').evaluate((el) => ({
        top: el.scrollTop,
        overflow: el.scrollHeight - el.clientHeight,
      }))
    expect(await metrics()).toEqual({ top: 0, overflow: 0 })
    await page.getByRole('button', { name: 'Both', exact: true }).click()
    await settleLayout(page)
    expect((await metrics()).overflow).toBeGreaterThan(100)
    expect((await metrics()).top).toBe(0)
  })
}

for (const pane of ['source', 'preview'] as const) {
  test(`remote edits and undo retain the reading position while ${pane} is hidden`, async ({
    browser,
    baseURL,
  }) => {
    const pair = await openPair(browser, baseURL!)
    try {
      const reader = pair.pageB
      const fixture = makeDocument(60)
      await setSourceViaYjs(pair.pageA, fixture.source)
      await expect(reader.frameLocator('.preview-frame').locator('h2')).toHaveCount(60)
      await settleLayout(reader)
      await scrollPane(reader, pane, 'middle', fixture)
      const mode = pane === 'source' ? 'View' : 'Edit'
      await reader.getByRole('button', { name: mode, exact: true }).click()
      await settleLayout(reader)
      const prefix = '== Added\n\nAdded remotely.\n\n'
      await pair.pageA.evaluate((prefix) => window.__asciiweave!.ytext.insert(0, prefix), prefix)
      await expect.poll(() => getText(reader)).toBe(prefix + fixture.source)
      await expect(reader.frameLocator('.preview-frame').locator('body')).toContainText(
        'Added remotely.',
      )
      await settleLayout(reader)
      const shifted = { ...fixture, middleLine: fixture.middleLine + prefix.split('\n').length - 1 }
      await expectPosition(reader, mode, 'middle', shifted)
      await reader.getByRole('button', { name: 'Both', exact: true }).click()
      await settleLayout(reader)
      await expectPosition(reader, 'Both', 'middle', shifted)
      await reader.getByRole('button', { name: mode, exact: true }).click()
      await pair.pageA.locator('.cm-content').focus()
      await pair.pageA.keyboard.press('ControlOrMeta+z')
      await expect.poll(() => getText(reader)).toBe(fixture.source)
      await expect(reader.frameLocator('.preview-frame').locator('h2')).toHaveCount(60)
      await reader.getByRole('button', { name: 'Both', exact: true }).click()
      await settleLayout(reader)
      await expectPosition(reader, 'Both', 'middle', fixture)
    } finally {
      await pair.close()
    }
  })
}

for (const latest of ['source', 'preview'] as const) {
  test(`rapid mode changes preserve newer ${latest} navigation`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await createDoc(page)
    const fixture = makeDocument(60)
    await setSourceViaYjs(page, fixture.source)
    await expect(page.frameLocator('.preview-frame').locator('h2')).toHaveCount(60)
    await settleLayout(page)
    await scrollPane(page, 'source', 'middle', fixture)
    const sourceTop = await page.locator('.cm-scroller').evaluate((el) => el.scrollTop)
    await scrollPane(page, 'source', 'start', fixture)
    await page.evaluate(
      ({ latest, sourceTop }) => {
        const scroller = document.querySelector('.cm-scroller')!
        const doc = document.querySelector<HTMLIFrameElement>('.preview-frame')!.contentDocument!
        const source = () => {
          scroller.scrollTop = sourceTop
          scroller.dispatchEvent(new Event('scroll'))
        }
        const preview = () => {
          doc.scrollingElement!.scrollTop += doc
            .getElementById('_topic_10')!
            .getBoundingClientRect().top
          doc.dispatchEvent(new Event('scroll'))
        }
        if (latest === 'source') {
          preview()
          source()
        } else {
          source()
          preview()
        }
        for (const mode of ['view', 'both', 'edit', 'view', 'both']) {
          document.querySelector<HTMLButtonElement>(`button[data-layout="${mode}"]`)!.click()
        }
      },
      { latest, sourceTop },
    )
    await settleLayout(page)
    const expected =
      latest === 'source'
        ? fixture
        : {
            ...fixture,
            middle: fixture.sections[9],
            middleLine: 37,
          }
    await expectPosition(page, 'Both', 'middle', expected)
  })
}
