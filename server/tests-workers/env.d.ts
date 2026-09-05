import type { D1Migration } from 'cloudflare:test'
import type { CollabRoom } from '../src/worker/room'

// Bindings visible to the workers test runner: DB from wrangler.jsonc,
// TEST_MIGRATIONS from vitest.workers.config.ts.
declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database
      ROOMS: DurableObjectNamespace<CollabRoom>
      TEST_MIGRATIONS: D1Migration[]
    }
  }
}

export {}
