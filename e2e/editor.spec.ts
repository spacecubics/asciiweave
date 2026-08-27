import { expect, test, type Page } from '@playwright/test'

const DOC_URL = /\/doc\/[A-Za-z0-9_-]+$/

async function createDoc(page: Page): Promise<string> {
  await page.goto('/')
  await page.getByRole('button', { name: 'New document' }).click()
  await page.waitForURL(DOC_URL)
  // Content arrives via collaboration sync; wait for it before editing.
  await expect(page.locator('.cm-content')).toContainText('Untitled Document')
  return page.url()
}

async function replaceSource(page: Page, source: string): Promise<void> {
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(source)
}

function waitForSave(page: Page): Promise<unknown> {
  return page.waitForResponse(
    (res) => res.url().includes('/api/documents/') && res.request().method() === 'PUT' && res.ok(),
  )
}

test('creating a document from / navigates to a stable /doc/<id> URL', async ({ page }) => {
  const url = await createDoc(page)
  expect(url).toMatch(DOC_URL)

  await page.reload()
  expect(page.url()).toBe(url)
  await expect(page.locator('.cm-content')).toContainText('Untitled Document')
})

test('editing the source updates the rendered preview', async ({ page }) => {
  await createDoc(page)
  await replaceSource(page, '== Section Heading\n\nHello *asciiweave* preview.')

  const preview = page.frameLocator('iframe.preview-frame')
  await expect(preview.locator('h2')).toHaveText('Section Heading')
  await expect(preview.locator('strong')).toHaveText('asciiweave')
})

test('edits are autosaved and survive a reload', async ({ page }) => {
  await createDoc(page)
  const saved = waitForSave(page)
  await replaceSource(page, '= Saved Title\n\nThis line must persist.')
  await saved
  await expect(page.locator('#save-state')).toHaveText('Saved')

  await page.reload()
  await expect(page.locator('.cm-content')).toContainText('This line must persist.')
})

test('two documents remain isolated', async ({ page }) => {
  const urlA = await createDoc(page)
  const saved = waitForSave(page)
  await replaceSource(page, 'content only for document A')
  await saved

  const urlB = await createDoc(page)
  expect(urlB).not.toBe(urlA)
  await expect(page.locator('.cm-content')).toContainText('Untitled Document')
  await expect(page.locator('.cm-content')).not.toContainText('document A')

  await page.goto(urlA)
  await expect(page.locator('.cm-content')).toContainText('content only for document A')
})

test('Japanese text is preserved through save and reload', async ({ page }) => {
  await createDoc(page)
  const saved = waitForSave(page)
  await replaceSource(page, '= 日本語の文書\n\nこんにちは、世界。絵文字 🌸 も動きます。')
  await saved

  await page.reload()
  await expect(page.locator('.cm-content')).toContainText(
    'こんにちは、世界。絵文字 🌸 も動きます。',
  )
  const preview = page.frameLocator('iframe.preview-frame')
  await expect(preview.locator('h1')).toHaveText('日本語の文書')
})

test('malformed AsciiDoc does not break the editor or preview', async ({ page }) => {
  await createDoc(page)
  await replaceSource(page, '----\n[[[]]\n====\ninclude::/etc/passwd[]\n|===\n')

  // The application must stay responsive: further edits still render.
  await replaceSource(page, '== Recovered\n\nStill working.')
  const preview = page.frameLocator('iframe.preview-frame')
  await expect(preview.locator('h2')).toHaveText('Recovered')
})

test('an unknown document id shows a not-found page', async ({ page }) => {
  await page.goto('/doc/doesnotexist123')
  await expect(page.getByText('Document not found')).toBeVisible()
})

test('rapid typing never leaves a stale preview', async ({ page }) => {
  await createDoc(page)
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  // Type quickly so multiple debounced conversions overlap.
  await page.keyboard.type('= Title\n\n', { delay: 5 })
  for (let i = 1; i <= 20; i++) {
    await page.keyboard.type(`line ${i} `, { delay: 5 })
  }
  await page.keyboard.type('\n\nfinal marker', { delay: 5 })

  const preview = page.frameLocator('iframe.preview-frame')
  await expect(preview.locator('body')).toContainText('final marker')
  await expect(preview.locator('body')).toContainText('line 20')
})
