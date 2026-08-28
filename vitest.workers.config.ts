import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// Runs the repository-contract tests against a real local D1 database
// inside the Workers runtime (workerd), using the same wrangler.jsonc
// and migration files as deployments: npm run test:workers.
export default defineConfig(async () => {
  const migrations = await readD1Migrations('migrations')
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          // Handed to the per-test setup, which applies them to the
          // isolated D1 database before each test file.
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    test: {
      include: ['server/tests-workers/**/*.test.ts'],
      setupFiles: ['server/tests-workers/apply-migrations.ts'],
    },
  }
})
