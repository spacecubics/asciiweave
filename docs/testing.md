# Testing

Automated tests should cover behavior, not just component existence. The test
suite spans the browser application, Node server, Cloudflare Worker, SQLite,
D1, and real multi-browser collaboration.

## Test layers

| Command                | Coverage                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `npm test`             | Browser-independent application logic, API behavior, SQLite persistence, collaboration rooms, and CRDT durability |
| `npm run test:workers` | The shared storage contract against local D1 and Worker API behavior in workerd                                   |
| `npm run test:e2e`     | Real-browser editing, preview, collaboration, presence, room isolation, and restart durability                    |
| `npm run typecheck`    | Node/browser and Worker TypeScript projects                                                                       |
| `npm run lint`         | ESLint checks across the repository                                                                               |
| `npm run format:check` | Prettier formatting without modifying files                                                                       |
| `npm run build`        | Production browser bundle                                                                                         |

The storage layer has one behavioral contract suite
(`server/tests/store-contract.ts`) that runs against both databases:
`npm test` covers `node:sqlite`, and `npm run test:workers` covers D1.

## Coverage expectations

Preserve coverage for:

- unique stable document IDs and room isolation;
- SQLite and D1 storage through their shared contract suite;
- Unicode and Japanese round trips;
- CodeMirror/`Y.Text` synchronization and Yjs-aware undo/redo;
- local and remote preview updates and stale-render rejection;
- concurrent edits, disconnection, reconnection, and convergence;
- awareness rendering and cleanup;
- CRDT restoration, corrupt-state fallback, and restart durability;
- plain `.adoc` export;
- both Node and Cloudflare implementations.

Add or update tests whenever behavior changes. Prefer assertions on observable
behavior over checks that a component, function, or file merely exists.

## Collaboration tests

At least one collaboration test must use independent real browser clients;
mocked WebSocket unit tests alone are insufficient. Exercise actual concurrent
operations, temporary disconnection, reconnection, convergence, and isolation
between different document IDs.

`main.ts` exposes `window.__asciiweave` as an integration-test hook so tests
can apply Yjs transactions outside CodeMirror, control the connection, and
verify convergence.

Durability coverage has two complementary layers:

- `server/tests/durability.test.ts` fuzzes persistence with seeded random
  mixed-script edits, restore chains, and multi-peer divergence.
- `e2e/durability.spec.ts` manages its own server and database so it can
  SIGKILL the server mid-session, restart it, and verify restoration and client
  reconvergence, including for a pre-CRDT legacy database.

The Playwright suite builds the app and starts the Node.js server on a temporary
database automatically. Install its browser once before the first run:

```sh
npx playwright install chromium
```

## Validation sequence

Run the checks appropriate to the scope of a change. The complete sequence is:

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:workers
npm run build
npm run test:e2e
```
