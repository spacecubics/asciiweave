# asciiweave

A HackMD-like collaborative web editor for AsciiDoc. Create a document, get a
stable shareable URL, edit AsciiDoc source in CodeMirror 6 on the left, and see
the live Asciidoctor.js preview on the right. When the document is ready, copy
the plain `.adoc` source into your own Git repository — Git integration is
intentionally not part of asciiweave.

This is **Phase 2**: a single-user editor with URL-based documents and
automatic persistence, where the live document is a Yjs `Y.Text` bound to
CodeMirror (still without networking). Real-time multi-user collaboration
arrives in Phase 3; see `asciiweave-ai-agent-instructions.md` for the
roadmap.

## Requirements

- Node.js >= 24 (uses the built-in `node:sqlite`; it prints an
  `ExperimentalWarning`, which is expected)

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

| Variable        | Default              | Meaning                  |
| --------------- | -------------------- | ------------------------ |
| `PORT`          | `8787`               | HTTP port                |
| `ASCIIWEAVE_DB` | `data/asciiweave.db` | SQLite database location |

## Tests and checks

```sh
npm test            # Vitest: API, persistence, render scheduler, autosave
npm run test:e2e    # Playwright: real-browser end-to-end tests
npm run typecheck   # tsc --noEmit
npm run lint        # ESLint
npm run format      # Prettier
```

The Playwright suite builds the app and starts a production-mode server on a
temporary database automatically. Run `npx playwright install chromium` once
before the first e2e run.

## Layout

```
app/     browser application (CodeMirror editor, Asciidoctor preview)
server/  HTTP API and SQLite persistence
e2e/     Playwright end-to-end tests
docs/    architecture notes
```
