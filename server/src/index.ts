import { readFileSync, existsSync } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createApp } from './app'
import { getActiveRoomSource, setupCollaboration } from './collaboration/rooms'
import { codec } from './collaboration/state'
import { openStore } from './persistence/sqlite'

const port = Number(process.env.PORT ?? 8787)
const dbPath = process.env.ASCIIWEAVE_DB ?? 'data/asciiweave.db'
const appDist = 'app/dist'

// openStore applies any pending migrations from migrations/ at startup
// (forward-only, transactional); a failure aborts startup with the
// failing migration named.
const store = openStore(dbPath)
const app = createApp(store, codec, { liveSource: getActiveRoomSource })

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
