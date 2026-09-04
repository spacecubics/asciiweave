# Node.js deployment

This guide covers running the Node.js target as a persistent service on one
machine. It uses the built browser application, the Hono Node.js server,
in-process WebSocket rooms, and a local `node:sqlite` database.

## Security boundary

asciiweave has no application-level authentication or authorization. Anyone
who can reach the service can create documents, and anyone who knows a document
URL can view, edit, and export it. Put the complete service behind a trusted
network or an authenticating reverse proxy before allowing remote access.

Run only one Node.js process for a database. Collaboration rooms live in that
process, so multiple replicas would create multiple writers for the same
document even if they shared the SQLite file.

## Prepare a release

Install Node.js 26 or later. From the repository root, install the locked
dependencies and build the browser application:

```sh
npm ci
npm run build
```

Do not omit development dependencies: the current start command uses `tsx`,
and the build uses Vite.

## Configure the process

Set configuration in the shell or service manager that launches asciiweave:

| Variable        | Default              | Recommendation                                    |
| --------------- | -------------------- | ------------------------------------------------- |
| `PORT`          | `8787`               | Point the reverse proxy to this application port  |
| `ASCIIWEAVE_DB` | `data/asciiweave.db` | Use an absolute path outside the source checkout  |
| `GIT_COMMIT`    | `dev`                | Set the deployed revision for the health response |

For example:

```sh
export PORT=8787
export ASCIIWEAVE_DB=/var/lib/asciiweave/asciiweave.db
export GIT_COMMIT="$(git rev-parse HEAD)"
npm start
```

The database directory must be writable by the service account. Start the
server from the repository root because it resolves the built browser assets
as `app/dist`. The npm scripts do not automatically load `.env.example` or a
copied `.env` file.

For unattended operation, use a process manager that:

- sets the repository root as the working directory;
- supplies the selected environment variables;
- runs `npm start` as an unprivileged service account;
- restarts the process after a failure; and
- sends `SIGTERM` for a normal stop so the HTTP server and database close.

## Reverse proxy

The Node.js server handles the browser application, HTTP API, and collaboration
WebSocket on the same port. A reverse proxy must:

- proxy `/`, `/doc/*`, `/api/*`, and `/assets/*` as ordinary HTTP requests;
- preserve and upgrade WebSocket connections for `/collab/*`;
- terminate TLS for access outside the local machine; and
- enforce authentication or network access policy for the entire origin.

Restrict the application port with a host firewall or equivalent network
policy so clients cannot bypass the access-controlling proxy.

If `/collab/*` upgrades are not forwarded, the editor can load but remains
`Offline` and changes do not reach the server.

## Verify the service

The health endpoint checks database connectivity and reports the configured
revision:

```sh
curl -fsS http://127.0.0.1:8787/api/health
```

Expected response:

```json
{ "ok": true, "commit": "<deployed-revision>" }
```

Also create a document through the deployed URL, open it in two browser
windows, and confirm that an edit reaches both windows and the topbar reports
`Synced`.

## Migrations and upgrades

The server applies pending migrations from `migrations/` at startup. Migrations
are numbered, immutable, forward-only, and applied transactionally one file at
a time. To inspect or apply them explicitly against the configured database:

```sh
npm run db:status
npm run db:migrate
```

For an upgrade:

1. Install the locked dependencies and build the new revision.
2. Stop the running process cleanly.
3. Back up the SQLite database directory.
4. Start the new revision, allowing it to apply pending migrations.
5. Check `/api/health`, then verify real WebSocket collaboration.

Before rolling code back, confirm that the older revision works with every
migration already applied. A code rollback does not roll back the SQLite
schema.

## Backup and restore

Do not copy only the main database file while the service is writing: SQLite
runs in WAL mode and may have live `-wal` and `-shm` sidecar files. For a simple
file-level backup, stop asciiweave cleanly and copy the entire directory that
contains `ASCIIWEAVE_DB`. A SQLite-aware online backup tool may be used instead
while the service remains available.

To restore a file-level backup, stop the service, replace the complete database
directory with the backup, ensure the service account owns it, and start the
same or a schema-compatible application revision. Verify health and
collaboration after restoration.
