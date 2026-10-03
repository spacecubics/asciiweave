import { expect, type Browser, type Page } from '@playwright/test'

export async function createDoc(page: Page, baseURL = ''): Promise<string> {
  await page.goto(`${baseURL}/`)
  await page.getByRole('button', { name: 'New document' }).click()
  await page.waitForURL(/\/doc\/[A-Za-z0-9_-]+$/)
  // Content arrives via collaboration sync; wait for it before editing.
  await expect(page.locator('.cm-content')).toContainText('Untitled Document')
  return page.url()
}

export async function openPair(browser: Browser, baseURL: string) {
  // Separate contexts give each collaborator independent browser state.
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const url = await createDoc(pageA, baseURL)
  const pageB = await ctxB.newPage()
  await pageB.goto(url)
  await expect(pageB.locator('.cm-content')).toContainText('Untitled Document')
  return {
    pageA,
    pageB,
    ctxA,
    ctxB,
    url,
    close: async () => {
      await ctxA.close()
      await ctxB.close()
    },
  }
}

export function getText(page: Page): Promise<string> {
  return page.evaluate(() => window.__asciiweave?.ytext.toString() ?? '')
}

export function firstSourceLine(page: Page): Promise<number> {
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

export async function scrollSourceToLine(page: Page, line: number): Promise<void> {
  await page.locator('.cm-scroller').evaluate(async (scroller, targetLine) => {
    const content = scroller.querySelector<HTMLElement>('.cm-content')
    const renderedLine = content?.querySelector<HTMLElement>('.cm-line')
    if (!content || !renderedLine) {
      throw new Error('missing rendered CodeMirror line')
    }

    const lineHeight = renderedLine.getBoundingClientRect().height
    const paddingTop = Number.parseFloat(getComputedStyle(content).paddingTop)
    scroller.scrollTop = paddingTop + (targetLine - 1) * lineHeight
    scroller.dispatchEvent(new Event('scroll'))
    await new Promise(requestAnimationFrame)

    // Fractional line heights accumulate error over a long document. Once
    // CodeMirror has rendered the target, align its gutter line exactly.
    const gutterLine = Array.from(
      scroller.closest('.cm-editor')!.querySelectorAll<HTMLElement>('.cm-gutterElement'),
    ).find((element) => element.textContent === String(targetLine))
    if (!gutterLine) {
      throw new Error('missing target CodeMirror gutter line')
    }
    scroller.scrollTop +=
      gutterLine.getBoundingClientRect().top - scroller.getBoundingClientRect().top + 1
    scroller.dispatchEvent(new Event('scroll'))
  }, line)
}

export async function replaceSource(page: Page, source: string): Promise<void> {
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(source)
}

export function setSourceViaYjs(page: Page, source: string): Promise<void> {
  return page.evaluate((text) => {
    const hook = window.__asciiweave
    if (!hook) {
      throw new Error('missing __asciiweave test hook')
    }
    hook.ydoc.transact(() => {
      hook.ytext.delete(0, hook.ytext.length)
      hook.ytext.insert(0, text)
    }, 'e2e-programmatic')
  }, source)
}
