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
