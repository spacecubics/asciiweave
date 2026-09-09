import { expect, test } from '@playwright/test'
import { createDoc, getText, replaceSource, setSourceViaYjs } from './helpers'

test('typing in CodeMirror modifies the shared Y.Text', async ({ page }) => {
  await createDoc(page)
  await replaceSource(page, '= Typed\n\ninto codemirror')

  const ytextContent = await getText(page)
  expect(ytextContent).toBe('= Typed\n\ninto codemirror')
})

test('programmatic Y.Text changes appear in the editor and the preview', async ({ page }) => {
  await createDoc(page)
  await setSourceViaYjs(page, '= Programmatic\n\ninjected via a Yjs transaction')

  await expect(page.locator('.cm-content')).toContainText('injected via a Yjs transaction')
  const preview = page.frameLocator('iframe.preview-frame')
  await expect(preview.locator('h1')).toHaveText('Programmatic')
  await expect(preview.locator('body')).toContainText('injected via a Yjs transaction')
})

test('programmatic Y.Text changes persist server-side like typed ones', async ({ page }) => {
  await createDoc(page)
  await setSourceViaYjs(page, '= Yjs Origin\n\npersisted without keyboard input')

  const id = new URL(page.url()).pathname.split('/').pop()!
  await expect
    .poll(async () => {
      const res = await page.request.get(`/api/documents/${id}`)
      return ((await res.json()) as { source: string }).source
    })
    .toContain('persisted without keyboard input')

  await page.reload()
  await expect(page.locator('.cm-content')).toContainText('persisted without keyboard input')
})

test('undo reverts typed edits but never the loaded document', async ({ page }) => {
  await createDoc(page)
  await page.locator('.cm-content').click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(' EXTRA')
  await expect(page.locator('.cm-content')).toContainText('here. EXTRA')

  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.locator('.cm-content')).toContainText('Untitled Document')
  await expect(page.locator('.cm-content')).not.toContainText('EXTRA')

  // Undoing further must not erase the content loaded from the server.
  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.locator('.cm-content')).toContainText('Untitled Document')

  // Capital Z: with Shift held a real keyboard reports key "Z".
  await page.keyboard.press('ControlOrMeta+Shift+Z')
  await expect(page.locator('.cm-content')).toContainText('here. EXTRA')
})

test('undo and redo stay converged with Y.Text and the preview', async ({ page }) => {
  await createDoc(page)
  await replaceSource(page, '== Redo Target\n\nvisible content')

  const preview = page.frameLocator('iframe.preview-frame')
  await expect(preview.locator('h2')).toHaveText('Redo Target')

  await page.keyboard.press('ControlOrMeta+z')
  const afterUndo = await getText(page)
  await expect(page.locator('.cm-content')).toContainText('Untitled Document')
  expect(afterUndo).toContain('Untitled Document')

  await page.keyboard.press('ControlOrMeta+Shift+Z')
  const afterRedo = await getText(page)
  expect(afterRedo).toContain('== Redo Target')
  await expect(preview.locator('h2')).toHaveText('Redo Target')
})
