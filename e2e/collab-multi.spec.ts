import { expect, test, type Page } from '@playwright/test'
import { createDoc, getText, openPair, replaceSource } from './helpers'

// Real multi-client collaboration tests: two independent browser contexts
// talking to the same server over real WebSockets — no mocks.

function transact(page: Page, fn: string): Promise<void> {
  return page.evaluate((body) => {
    const hook = window.__asciiweave
    if (!hook) {
      throw new Error('missing __asciiweave test hook')
    }
    hook.ydoc.transact(() => {
      new Function('ytext', body)(hook.ytext)
    })
  }, fn)
}

async function expectConverged(pageA: Page, pageB: Page, markers: string[]): Promise<void> {
  await expect
    .poll(
      async () => {
        const [a, b] = await Promise.all([getText(pageA), getText(pageB)])
        if (a !== b) {
          return `diverged A=${JSON.stringify(a)} B=${JSON.stringify(b)}`
        }
        const missing = markers.filter((m) => !a.includes(m))
        return missing.length === 0 ? 'converged' : `missing ${missing.join(', ')} in ${a}`
      },
      { timeout: 10_000 },
    )
    .toBe('converged')
}

test('edits in one browser appear in the other without refresh', async ({ browser, baseURL }) => {
  const pair = await openPair(browser, baseURL!)
  const { pageA, pageB } = pair

  await replaceSource(pageA, '== Shared Heading\n\ntyped in browser A')

  await expect(pageB.locator('.cm-content')).toContainText('typed in browser A')
  // Each client renders its own preview locally from the shared source.
  const previewB = pageB.frameLocator('iframe.preview-frame')
  await expect(previewB.locator('h2')).toHaveText('Shared Heading')
  await expectConverged(pageA, pageB, ['typed in browser A'])
  await pair.close()
})

test('concurrent edits at different positions converge', async ({ browser, baseURL }) => {
  const pair = await openPair(browser, baseURL!)
  const { pageA, pageB } = pair

  await Promise.all([
    transact(pageA, "ytext.insert(0, 'A-AT-START ')"),
    transact(pageB, "ytext.insert(ytext.length, ' B-AT-END')"),
  ])

  await expectConverged(pageA, pageB, ['A-AT-START', 'B-AT-END'])
  await pair.close()
})

test('concurrent inserts at the same position converge to identical text', async ({
  browser,
  baseURL,
}) => {
  const pair = await openPair(browser, baseURL!)
  const { pageA, pageB } = pair

  await Promise.all([
    transact(pageA, "ytext.insert(0, '[FROM-A]')"),
    transact(pageB, "ytext.insert(0, '[FROM-B]')"),
  ])

  // Which order Yjs picks is not asciiweave's concern — only that every
  // client ends up with the same text containing both inserts.
  await expectConverged(pageA, pageB, ['[FROM-A]', '[FROM-B]'])
  await pair.close()
})

test('concurrent delete and insert in the same region converge', async ({ browser, baseURL }) => {
  const pair = await openPair(browser, baseURL!)
  const { pageA, pageB } = pair

  await transact(pageA, "ytext.delete(0, ytext.length); ytext.insert(0, 'abcdefghij')")
  await expectConverged(pageA, pageB, ['abcdefghij'])

  await Promise.all([
    transact(pageA, 'ytext.delete(2, 6)'), // delete "cdefgh"
    transact(pageB, "ytext.insert(5, '[B-INSIDE]')"), // insert inside that region
  ])

  await expect
    .poll(async () => {
      const [a, b] = await Promise.all([getText(pageA), getText(pageB)])
      return a === b ? 'converged' : `diverged A=${a} B=${b}`
    })
    .toBe('converged')
  await pair.close()
})

test('a temporarily disconnected client converges after reconnecting', async ({
  browser,
  baseURL,
}) => {
  const pair = await openPair(browser, baseURL!)
  const { pageA, pageB } = pair

  await pageB.evaluate(() => window.__asciiweave?.provider.disconnect())

  await transact(pageA, "ytext.insert(0, '[WHILE-B-OFFLINE-A] ')")
  await transact(pageB, "ytext.insert(ytext.length, ' [OFFLINE-EDIT-B]')")

  // B must not have received A's edit while disconnected.
  expect(await getText(pageB)).not.toContain('[WHILE-B-OFFLINE-A]')

  await pageB.evaluate(() => window.__asciiweave?.provider.connect())
  await expectConverged(pageA, pageB, ['[WHILE-B-OFFLINE-A]', '[OFFLINE-EDIT-B]'])
  await pair.close()
})

test('clients on different documents never receive each other updates', async ({
  browser,
  baseURL,
}) => {
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const pageB = await ctxB.newPage()
  for (const page of [pageA, pageB]) {
    await createDoc(page, baseURL!)
  }
  expect(pageA.url()).not.toBe(pageB.url())

  await transact(pageA, "ytext.insert(0, '[ONLY-IN-ROOM-A] ')")
  await expect.poll(() => getText(pageA)).toContain('[ONLY-IN-ROOM-A]')

  // Give the server time to (incorrectly) fan out before asserting.
  await pageA.waitForTimeout(750)
  expect(await getText(pageB)).not.toContain('[ONLY-IN-ROOM-A]')
  await expect(pageB.locator('.cm-content')).toContainText('Untitled Document')

  await ctxA.close()
  await ctxB.close()
})
