import * as Y from 'yjs'
import type { Env } from './env'
import { createApp } from '../app'
import { createCodec } from '../collaboration/codec'
import { createD1Store } from '../persistence/d1'

export { CollabRoom } from './room'

// Cloudflare Worker entry point. The browser talks only to the API and
// the collaboration WebSocket — never to D1 directly. Static assets are
// served by Workers Assets (wrangler.jsonc `assets`, SPA fallback);
// only /api/* and /collab/* reach this code (`run_worker_first`).

const COLLAB_PATH = /^\/collab\/([A-Za-z0-9_-]+)$/

const codec = createCodec(Y)

function roomStub(env: Env, id: string) {
  return env.ROOMS.get(env.ROOMS.idFromName(id))
}

// Ask the document's Durable Object for its current text. If the room
// is live this is fresher than the debounced D1 snapshot; if not, the
// Object restores from D1 and returns the same persisted state.
async function liveSource(env: Env, id: string): Promise<string | undefined> {
  const response = await roomStub(env, id).fetch(
    `https://collab-room/source?doc=${encodeURIComponent(id)}`,
  )
  return response.ok ? await response.text() : undefined
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    const collab = COLLAB_PATH.exec(url.pathname)
    if (collab?.[1]) {
      const id = collab[1]
      // Rewrite to the Object's internal URL, preserving the original
      // headers so the WebSocket upgrade passes through.
      return roomStub(env, id).fetch(
        new Request(`https://collab-room/ws?doc=${encodeURIComponent(id)}`, request),
      )
    }

    const app = createApp(createD1Store(env.DB), codec, {
      liveSource: (id) => liveSource(env, id),
      commit: env.GIT_COMMIT,
    })
    return app.fetch(request)
  },
}
