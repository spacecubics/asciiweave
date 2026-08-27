import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from '@playwright/test'

const port = 8791
const dbPath = join(mkdtempSync(join(tmpdir(), 'asciiweave-e2e-')), 'e2e.db')

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  use: {
    baseURL: `http://localhost:${port}`,
  },
  webServer: {
    command: 'npm run build && npm start',
    url: `http://localhost:${port}`,
    env: { PORT: String(port), ASCIIWEAVE_DB: dbPath },
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
