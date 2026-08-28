import type { D1Migration } from 'cloudflare:test'

// Bindings visible to the workers test runner: DB from wrangler.jsonc,
// TEST_MIGRATIONS from vitest.workers.config.ts.
declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database
      TEST_MIGRATIONS: D1Migration[]
    }
  }
}

export {}
