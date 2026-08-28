// Bindings declared in wrangler.jsonc. Checked by tsconfig.worker.json
// against @cloudflare/workers-types.
export interface Env {
  DB: D1Database
  ROOMS: DurableObjectNamespace
  // Set per deployment (--var GIT_COMMIT:<sha>) and reported by
  // /api/health.
  GIT_COMMIT?: string
}
