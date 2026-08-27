import { readFileSync, existsSync } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createApp } from './app'
import { setupCollaboration } from './collaboration/rooms'
import { openStore } from './persistence/db'

const port = Number(process.env.PORT ?? 8787)
const dbPath = process.env.ASCIIWEAVE_DB ?? 'data/asciiweave.db'
const appDist = 'app/dist'

const store = openStore(dbPath)
const app = createApp(store)

// Serve the built browser app when it exists (production / e2e). During
// development Vite serves the app instead and proxies /api here.
if (existsSync(join(appDist, 'index.html'))) {
  const indexHtml = readFileSync(join(appDist, 'index.html'), 'utf8')
  app.use('/assets/*', serveStatic({ root: appDist }))
  app.get('/', (c) => c.html(indexHtml))
  app.get('/doc/:id', (c) => c.html(indexHtml))
}

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`asciiweave server listening on http://localhost:${info.port}`)
})

setupCollaboration(server as Server, store)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close()
    store.close()
    process.exit(0)
  })
}
