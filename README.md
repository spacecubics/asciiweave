# asciiweave

A HackMD-like collaborative web editor for AsciiDoc. Create a document, get a
stable shareable URL, edit AsciiDoc source in CodeMirror 6 on the left, and see
the live Asciidoctor.js preview on the right. When the document is ready, copy
the plain `.adoc` source into your own Git repository — Git integration is
intentionally not part of asciiweave.

Currently at **Phase 4.3**: everyone who opens the same `/doc/<id>` URL
edits the same document in real time, with named, colored remote cursors
and selections and a connected-user indicator. The live document is a Yjs
`Y.Text` synchronized over WebSockets (`y-websocket`); the durably
persisted CRDT state on the server is the one authoritative store, and
each browser renders its own preview locally. Plain `.adoc` source is
derived data, available from `GET /api/documents/<id>/source` for
committing to Git. See `asciiweave-ai-agent-instructions.md` for the
roadmap.

asciiweave has two server targets sharing the same application code:

| Target              | Runtime         | Persistent database |
| ------------------- | --------------- | ------------------- |
| Local / on-premises | Node.js 26      | `node:sqlite` file  |
| Cloudflare          | Workers runtime | D1 binding          |

See `docs/deployment.md` for the Cloudflare staging/production workflow.

## Requirements

- Node.js >= 26 (`.nvmrc` pins the tested release; uses the built-in
  `node:sqlite`)

## Development

```sh
npm install
npm run dev
```

`npm run dev` starts the API server on <http://localhost:8787> and the Vite
dev server on <http://localhost:5173> (open the Vite URL; it proxies `/api`).

## Production build

```sh
npm run build
npm start
```

`npm start` serves the built app and the API on <http://localhost:8787>.

Configuration via environment variables:

| Variable        | Default              | Meaning                   |
| --------------- | -------------------- | ------------------------- |
| `PORT`          | `8787`               | HTTP port                 |
| `ASCIIWEAVE_DB` | `data/asciiweave.db` | SQLite database location  |
| `GIT_COMMIT`    | `dev`                | Reported by `/api/health` |

(`.env.example` lists the same names.) The server applies pending SQL
migrations from `migrations/` at startup; `npm run db:status` and
`npm run db:migrate` run them by hand against `ASCIIWEAVE_DB`.

## Tests and checks

```sh
npm test              # Vitest: API, persistence, render scheduler, autosave
npm run test:workers  # same storage contract against local D1 in workerd
npm run test:e2e      # Playwright: real-browser end-to-end tests
npm run typecheck     # tsc: Node/browser project + Workers project
npm run lint          # ESLint
npm run format        # Prettier
```

The storage layer has one behavioral contract suite
(`server/tests/store-contract.ts`) that runs against both databases:
`npm test` covers `node:sqlite`, `npm run test:workers` covers D1.

The Playwright suite builds the app and starts a production-mode server on a
temporary database automatically. Run `npx playwright install chromium` once
before the first e2e run.

## Layout

```
app/         browser application (CodeMirror editor, Asciidoctor preview)
server/      HTTP API, collaboration, and persistence (Node + Worker)
migrations/  numbered SQL migrations shared by SQLite and D1
e2e/         Playwright end-to-end tests
docs/        architecture and deployment notes
```
