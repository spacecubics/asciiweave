import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, test, type Page } from '@playwright/test'
import * as Y from 'yjs'

// Phase 4.2: durable CRDT state. These tests manage their own server
// process (instead of Playwright's shared webServer) so they can kill
// it hard mid-session and restart it on the same database.

// Tests may run in parallel worker processes; give each worker its own
// port so their private servers never collide.
const PORT = 8795 + Number(process.env.TEST_WORKER_INDEX ?? 0)
const BASE = `http://localhost:${PORT}`

let dbPath: string
let server: ChildProcess | undefined

async function startServer(): Promise<void> {
  // A stale server squatting on the port would silently serve a
  // different database and invalidate every assertion — fail loudly.
  const portTaken = await fetch(`${BASE}/`).then(
    () => true,
    () => false,
  )
  if (portTaken) {
    throw new Error(`port ${PORT} is already in use — kill the stale server first`)
  }
  // --import=tsx keeps the server in this one process (the tsx bin
  // wrapper would re-spawn node, and SIGKILL would only hit the wrapper).
  server = spawn(process.execPath, ['--import=tsx', 'server/src/index.ts'], {
    env: { ...process.env, PORT: String(PORT), ASCIIWEAVE_DB: dbPath },
    stdio: 'ignore',
  })
  await expect
    .poll(
      () =>
        fetch(`${BASE}/`)
          .then((r) => r.ok)
          .catch(() => false),
      { timeout: 15_000 },
    )
    .toBe(true)
}

function killServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve()
      return
    }
    server.once('exit', () => resolve())
    // SIGKILL: durability must not depend on a graceful shutdown.
    server.kill('SIGKILL')
    server = undefined
  })
}

test.beforeEach(() => {
  dbPath = join(mkdtempSync(join(tmpdir(), 'asciiweave-durability-')), 'test.db')
})

test.afterEach(async () => {
  await killServer()
})

function getText(page: Page): Promise<string> {
  return page.evaluate(() => window.__asciiweave?.ytext.toString() ?? '')
}

async function createDoc(page: Page): Promise<string> {
  await page.goto(`${BASE}/`)
  await page.getByRole('button', { name: 'New document' }).click()
  await page.waitForURL(/\/doc\/[A-Za-z0-9_-]+$/)
  await expect(page.locator('.cm-content')).toContainText('Untitled Document')
  return page.url()
}

async function replaceAll(page: Page, source: string): Promise<void> {
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(source)
}

// The debounced persist runs ~1s after the last update. Read the
// durable CRDT state straight out of SQLite (WAL allows a concurrent
// reader) and decode it, so this cannot be satisfied by the plain-text
// autosave path.
async function waitForPersist(page: Page, marker: string): Promise<void> {
  const id = new URL(page.url()).pathname.split('/').pop()!
  await expect
    .poll(
      () => {
        try {
          const db = new DatabaseSync(dbPath, { readOnly: true })
          try {
            const row = db.prepare('SELECT state FROM yjs_state WHERE id = ?').get(id) as
              { state: Uint8Array } | undefined
            if (!row) {
              return ''
            }
            const ydoc = new Y.Doc()
            Y.applyUpdate(ydoc, row.state)
            return ydoc.getText('source').toString()
          } finally {
            db.close()
          }
        } catch (error) {
          return `read failed: ${String(error)}`
        }
      },
      { timeout: 10_000 },
    )
    .toContain(marker)
}

test('a collaborative session survives a hard server restart', async ({ browser }) => {
  await startServer()
  const ctxA = await browser.newContext()
  const ctxB = await browser.newContext()
  const pageA = await ctxA.newPage()
  const url = await createDoc(pageA)
  const pageB = await ctxB.newPage()
  await pageB.goto(url)
  await expect(pageB.locator('.cm-content')).toContainText('Untitled Document')

  await replaceAll(pageA, '= Durable\n\nwritten before the crash')
  await expect(pageB.locator('.cm-content')).toContainText('written before the crash')
  await waitForPersist(pageA, 'written before the crash')

  await killServer()
  await startServer()

  // Both clients reconnect on their own and still agree on the content.
  for (const page of [pageA, pageB]) {
    await expect
      .poll(() => getText(page), { timeout: 15_000 })
      .toContain('written before the crash')
  }

  // The room is alive again: edits still flow between the clients.
  await replaceAll(pageB, '= Durable\n\nwritten after the restart')
  expect(await getText(pageB)).toContain('written after the restart')
  await expect
    .poll(() => getText(pageA), { timeout: 15_000 })
    .toContain('written after the restart')
  await expect(pageA.locator('.cm-content')).toContainText('written after the restart')

  await ctxA.close()
  await ctxB.close()
})

test('durable state does not depend on a browser staying open', async ({ browser }) => {
  await startServer()
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const url = await createDoc(page)
  await replaceAll(page, '= Unattended\n\nnobody is watching this document')
  await waitForPersist(page, 'nobody is watching')

  // Close every client, then kill the server without ceremony.
  await ctx.close()
  await killServer()
  await startServer()

  const fresh = await (await browser.newContext()).newPage()
  await fresh.goto(url)
  await expect(fresh.locator('.cm-content')).toContainText('nobody is watching this document')
  await fresh.context().close()
})
