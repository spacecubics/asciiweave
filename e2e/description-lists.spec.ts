import { expect, test } from '@playwright/test'
import { createDoc, replaceSource } from './helpers'

test('description lists render terms, missing descriptions, and nested blocks', async ({
  page,
}) => {
  await createDoc(page)
  await replaceSource(
    page,
    `= Options

First term::
Alias:: Description with **emphasis**.
+
* Nested item

== Following section

Following paragraph.

Missing description::
`,
  )
  const preview = page.frameLocator('.preview-frame')
  await expect(preview.locator('dt')).toHaveText(['First term', 'Alias', 'Missing description'])
  await expect(preview.locator('dd strong')).toHaveText('emphasis')
  await expect(preview.locator('dd li')).toHaveText('Nested item')
  await expect(preview.locator('h2')).toHaveText('Following section')
  await expect(preview.locator('.paragraph').last()).toContainText('Following paragraph.')
})
