import { expect, test, type Browser, type Page } from '@playwright/test'

// Phase 4.1: awareness — names, colors, remote cursors/selections, and
// the connected-user indicator, exercised with two real browsers.

async function openPair(browser: Browser, baseURL: string) {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  await pageA.goto(`${baseURL}/`)
  await pageA.getByRole('button', { name: 'New document' }).click()
  await pageA.waitForURL(/\/doc\/[A-Za-z0-9_-]+$/)
  const pageB = await ctxB.newPage()
  await pageB.goto(pageA.url())
  for (const page of [pageA, pageB]) {
    await expect(page.locator('.cm-content')).toContainText('Untitled Document')
  }
  return { pageA, pageB, ctxA, ctxB }
}

async function setName(page: Page, name: string): Promise<void> {
  await page.locator('#user-name').fill(name)
  await page.locator('#user-name').blur()
}

test('the connected-user indicator lists everyone and updates on leave', async ({
  browser,
  baseURL,
}) => {
  const { pageA, pageB, ctxA, ctxB } = await openPair(browser, baseURL!)
  await setName(pageA, 'Alice')
  await setName(pageB, 'Bob')

  for (const page of [pageA, pageB]) {
    await expect(page.locator('.user-chip')).toHaveCount(2)
    await expect(page.locator('#user-list')).toContainText('Alice')
    await expect(page.locator('#user-list')).toContainText('Bob')
  }
  // The local user is shown first.
  await expect(pageA.locator('.user-chip').first()).toHaveText('Alice')
  await expect(pageB.locator('.user-chip').first()).toHaveText('Bob')

  await ctxB.close()
  await expect(pageA.locator('.user-chip')).toHaveCount(1)
  await expect(pageA.locator('#user-list')).not.toContainText('Bob')
  await ctxA.close()
})

test('remote cursors appear with the collaborator name and color', async ({ browser, baseURL }) => {
  const { pageA, pageB, ctxA, ctxB } = await openPair(browser, baseURL!)
  await setName(pageB, 'Bob')

  // B placing a cursor must produce a labeled remote caret in A.
  await pageB.locator('.cm-content').click()
  const caret = pageA.locator('.cm-ySelectionCaret')
  await expect(caret).toHaveCount(1)
  await expect(caret.locator('.cm-ySelectionInfo')).toHaveText('Bob')
  const caretColor = await caret.evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(caretColor).toMatch(/^rgb\(/)

  // A has not placed a cursor, so B sees no remote caret yet.
  await expect(pageB.locator('.cm-ySelectionCaret')).toHaveCount(0)
  await ctxA.close()
  await ctxB.close()
})

test('remote selections are highlighted for collaborators', async ({ browser, baseURL }) => {
  const { pageA, pageB, ctxA, ctxB } = await openPair(browser, baseURL!)

  await pageB.locator('.cm-content').click()
  await pageB.keyboard.press('ControlOrMeta+a')

  await expect(pageA.locator('.cm-ySelection').first()).toBeVisible()
  await ctxA.close()
  await ctxB.close()
})

test('renaming propagates live and presence is never persisted', async ({ browser, baseURL }) => {
  const { pageA, pageB, ctxA, ctxB } = await openPair(browser, baseURL!)
  await setName(pageB, 'Before Rename')
  await expect(pageA.locator('#user-list')).toContainText('Before Rename')

  await setName(pageB, 'After Rename')
  await expect(pageA.locator('#user-list')).toContainText('After Rename')
  await expect(pageA.locator('#user-list')).not.toContainText('Before Rename')

  // Cursors, names, and presence must never leak into the document: the
  // persisted source still matches the editor text exactly.
  await pageB.locator('.cm-content').click()
  await pageB.keyboard.press('ControlOrMeta+a')
  const apiSource = await pageA.evaluate(async () => {
    const id = location.pathname.split('/').pop()
    const res = await fetch(`/api/documents/${id}`)
    return ((await res.json()) as { source: string }).source
  })
  const liveSource = await pageA.evaluate(() => window.__asciiweave?.ytext.toString())
  expect(apiSource).toBe(liveSource)
  expect(apiSource).not.toContain('Rename')
  await ctxA.close()
  await ctxB.close()
})
