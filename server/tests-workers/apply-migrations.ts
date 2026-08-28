import { applyD1Migrations, env } from 'cloudflare:test'

// Every test file starts from an empty D1 database created purely from
// the shared migration series — the same files Wrangler applies to the
// staging and production databases.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
