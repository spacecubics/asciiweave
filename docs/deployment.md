# Deployment

asciiweave has two server targets built from the same application code:

| Target              | Runtime         | Database           | Entry point                  |
| ------------------- | --------------- | ------------------ | ---------------------------- |
| Local / on-premises | Node.js 26      | `node:sqlite` file | `server/src/index.ts`        |
| Cloudflare          | Workers runtime | D1 (binding `DB`)  | `server/src/worker/index.ts` |

The browser never touches SQLite or D1; it talks only to the HTTP API
and the `/collab/<id>` WebSocket. On Cloudflare, each document's
WebSocket room is a `CollabRoom` Durable Object (the single writer for
that document), and static assets are served by Workers Assets with SPA
fallback. See `docs/architecture.md` for the design.

## Cloudflare resources

Everything lives in the corporate Cloudflare account
(cloudflare@spacecubics.com):

| Purpose    | Worker               | D1 database             | URL                                  |
| ---------- | -------------------- | ----------------------- | ------------------------------------ |
| Staging    | `asciiweave-staging` | `asciiweave-staging`    | workers.dev subdomain                |
| Production | `asciiweave`         | `asciiweave-production` | <https://asciiweave.spacecubics.org> |

The production URL is a Worker Custom Domain declared in
`wrangler.jsonc` (`routes` with `custom_domain: true`); Cloudflare
creates and maintains the DNS record and certificate for it on deploy.
The API token used for deployment therefore needs zone-level DNS and
Workers Routes permissions on `spacecubics.org` in addition to the
account-level Workers and D1 scopes.

`wrangler.jsonc` defines both as environments; the top-level config
(`asciiweave-dev`) exists only for local development and the workerd
test pool, so a bare `wrangler deploy` cannot touch a real target —
always pass `--env staging` or `--env production`.

## Authentication

- **Local CLI**: `npx wrangler login` (OAuth, browser flow). Check with
  `npx wrangler whoami` — it must show the corporate account. Never use
  a Global API Key.
- **GitHub CI**: repository secrets `CLOUDFLARE_API_TOKEN` (an API
  token scoped to Workers Scripts:Edit + D1:Edit on this account only)
  and `CLOUDFLARE_ACCOUNT_ID`. Create the token in the Cloudflare
  dashboard (My Profile → API Tokens), then store both with
  Settings → Secrets and variables → Actions, or
  `gh secret set CLOUDFLARE_API_TOKEN` fed from a secure source.
  Secrets are never exposed to pull requests from forks.

## Schema migrations

One numbered, immutable SQL series in `migrations/` serves both
databases. Once a file has been applied to staging or production, never
edit it — add a new numbered file.

- Local SQLite: applied automatically at server startup, or by hand:
  `npm run db:status` / `npm run db:migrate` (path from
  `ASCIIWEAVE_DB`). Tracking uses the same `d1_migrations` table
  Wrangler uses.
- D1: `npx wrangler d1 migrations apply DB --remote --env staging`
  (or `--env production`). Local simulator: drop `--remote`.

Keep migrations inside the SQLite subset D1 supports: no PRAGMAs, no
extensions. Connection setup such as WAL mode lives in
`server/src/persistence/sqlite.ts`, not in migrations.

## Branch → staging → production flow

1. **Pull requests / branches**: GitHub Actions runs lint, format,
   typecheck, unit tests, D1 contract tests (locally in workerd — no
   credentials), the production build, and the Playwright suite.
2. **Staging**: deploy manually — either the _Deploy staging_ workflow
   (`workflow_dispatch`, same-repository branches only) or locally:

   ```sh
   npm run build
   npx wrangler d1 migrations apply DB --remote --env staging
   npx wrangler deploy --env staging --var GIT_COMMIT:$(git rev-parse HEAD)
   ```

   (`npm run deploy:staging` bundles the same steps.) Verify
   `<staging-url>/api/health` reports `{"ok":true,"commit":<sha>}`.
   Do not drop or reset the staging database as part of routine tests.

3. **Production**: merge the reviewed pull request. The _Deploy
   production_ workflow runs on `push` to `main`: it repeats all tests,
   applies pending migrations to the production D1 database, deploys
   the `asciiweave` Worker only if migrations succeed, and smoke-tests
   `/api/health` on the deployed URL. Nothing deploys to production
   from a pull request.

Because the Worker implements a Durable Object, Cloudflare does not
generate preview URLs for uploaded versions — use the dedicated staging
Worker for integration testing.

## Rollback

- **Worker code**: `npx wrangler rollback --env production` (or the
  dashboard's Deployments page) reverts to a previous deployment.
  Rolling back code does **not** roll back the schema.
- **Schema**: prefer expand-and-contract — additive migration first,
  deploy code tolerating old and new schema, destructive cleanup only
  in a later migration once no deployed code needs the old shape. Never
  run a "down" migration automatically as part of a code rollback.
- **Data**: D1 Time Travel can restore the database to a point in the
  last 30 days (`wrangler d1 time-travel info asciiweave-production`);
  confirm retention on the account's plan before relying on it.
- The first production deployment only adds tables; restoring previous
  behavior never requires deleting the D1 database.

## Known differences: local SQLite vs D1

- `node:sqlite` is synchronous under an async interface; D1 is remote
  and asynchronous. Both sit behind `DocumentStore`
  (`server/src/persistence/store.ts`) and pass the same contract suite
  (`server/tests/store-contract.ts`).
- BLOBs: D1 returns `ArrayBuffer` and takes `ArrayBuffer` parameters;
  the D1 store converts to/from `Uint8Array` at the boundary.
- WAL mode and other PRAGMAs exist only on the Node target.
- The Node target keeps live rooms in process memory (y-websocket); the
  Worker keeps them in per-document Durable Objects. On both, the
  durable Yjs state is persisted debounced (~1 s), plus a flush when
  the last client leaves.
- The Durable Object does not ping idle WebSocket clients; dead
  connections are reaped by the runtime rather than by heartbeat.
