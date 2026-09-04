# asciiweave architecture

Decisions that are not obvious from the code alone.

## Core design principles

### AsciiDoc source is the document

The canonical user-authored content is plain AsciiDoc text held in a Yjs
`Y.Text` and persisted as Yjs state.

Do not introduce a rich-text JSON format, make an editable AST canonical, or
automatically rewrite or reformat the AsciiDoc source. A user must always be
able to obtain ordinary `.adoc` text suitable for committing to Git.

### Rendering is derived state

Rendered HTML is disposable derived state:

```text
AsciiDoc source
      |
      v
Asciidoctor.js
      |
      v
HTML preview
```

Each browser renders its synchronized source locally. Never persist or
synchronize rendered HTML, and never make it the canonical document.

### Collaboration operates on text

Synchronize the AsciiDoc source text. Do not make Yjs understand AsciiDoc
structure, synchronize the Asciidoctor AST, or implement a custom CRDT or OT
algorithm.

### A URL identifies one document

Each `/doc/<id>` URL identifies one independent AsciiDoc document and its Yjs
room. Document IDs must remain stable, random, non-sequential, and URL-safe.
Do not use a title or filename as the primary identity.

### Keep one authoritative store

Durable Yjs state is the authoritative document store, and the collaboration
path is its only writer. Plain AsciiDoc is derived from the live room or stored
CRDT state for display and export. The `documents.source` column is a legacy
fallback and derived cache, not a second source of truth.

Do not restore client-side HTTP autosave or another competing write path.

## Technology and compatibility

Use the established stack unless a requested change has a compelling reason
to alter it:

- TypeScript;
- CodeMirror 6;
- Asciidoctor.js 4 via `@asciidoctor/core`;
- Yjs v13;
- `y-codemirror.next`;
- the Yjs v13-compatible `y-websocket` generation;
- Vite;
- Hono;
- `node:sqlite` for the local/on-premises target;
- Cloudflare Workers, Durable Objects, and D1 for the hosted target.

Pin mutually compatible dependency versions in the lock file. Do not mix the
stable Yjs v13 packages with development packages from the Yjs v14 family,
such as `@y/y`, `@y/codemirror`, or `@y/websocket`.

The Node collaboration server and `y-websocket/bin/utils` must share one Yjs
module instance. Server code that manipulates room documents must load Yjs
through `createRequire`, as described under durable CRDT state below.

### Upstream references

- CodeMirror documentation: https://codemirror.net/docs/
- Asciidoctor.js documentation: https://docs.asciidoctor.org/asciidoctor.js/latest/
- Yjs CodeMirror 6 binding: https://github.com/yjs/y-codemirror.next
- Yjs WebSocket provider: https://github.com/yjs/y-websocket

Asciidoctor.js conversion is asynchronous. `y-codemirror.next` binds a Yjs
`Y.Text` to CodeMirror 6 and supports awareness-driven cursors, selections,
and Yjs-aware undo/redo. Check upstream compatibility guidance before changing
any of these packages.

## Server targets

The Node and Cloudflare targets share the application, persistence contract,
migrations, and CRDT codec:

| Target              | Runtime         | Rooms                          | Database      |
| ------------------- | --------------- | ------------------------------ | ------------- |
| Local / on-premises | Node.js >= 26   | In-process `y-websocket` rooms | `node:sqlite` |
| Cloudflare          | Workers runtime | Per-document Durable Objects   | D1            |

Keep runtime-specific dependencies at the composition roots. Shared modules
must not accidentally bundle `node:sqlite`, `createRequire`, or the wrong Yjs
build into the Worker.

Use one numbered, immutable SQL migration series from `migrations/` for both
SQLite and D1. Add migrations instead of editing files already applied to a
deployed database. See [`deployment-cloudflare.md`](deployment-cloudflare.md)
for environments, credentials, deployment, and rollback.

## Overall shape

```
POST /api/documents  ->  random ID  ->  /doc/<id>
                                          |
   browser A                       room owner                    browser B
     Y.Doc  <---- ws://…/collab/<id> ----+---- ws://…/collab/<id> ----> Y.Doc
       |                                 |                               |
     Y.Text                         server Y.Doc                       Y.Text
     /    \                              |                            /    \
CodeMirror  Asciidoctor.js         debounced snapshot       Asciidoctor.js  CodeMirror
                 |                       |                         |
          sandboxed iframe          SQLite or D1          sandboxed iframe
```

## Yjs document model

The live source in the browser is a `Y.Text` (`ydoc.getText('source')`),
bound to CodeMirror 6 with `y-codemirror.next`'s `yCollab` — there is no
second canonical copy in any store or editor model. The preview subscribes to
the `Y.Text` observer, so it reacts identically to keystrokes, programmatic
transactions, and remote collaborators' edits.

The `Y.UndoManager` does not track the provider's transaction origin, so
undo reverts only this user's own edits — never remote edits or the
content loaded from the server.

## Collaboration transport

The asciiweave document ID is the Yjs room name: `/doc/<id>` collaborates
through `ws://…/collab/<id>`. There is no second collaboration ID.

Both ends use `y-websocket 1.5.4`, pinned exactly: it is the stable Yjs
v13-compatible generation that ships the client provider and the proven
server (`y-websocket/bin/utils`) in one mutually compatible package. The
newer client-only y-websocket releases pair with `@y/websocket-server`,
which is built on the Yjs v14 development line that the project
instructions say not to mix in. Two traps in `bin/utils` worth knowing:
the persistence hooks must return promises (it chains `.then()` on
`writeState`, and a synchronous function crashes the process on
disconnect), and rooms are destroyed when their last client leaves.

The collaboration server (`server/src/collaboration/rooms.ts`) is
AsciiDoc-agnostic: it relays Yjs updates and awareness per room. Its only
contact with document content is as opaque text, in two places:

- **Seeding**: when a room is created, `bindState` inserts the persisted
  source into the room's `Y.Text` (guarded by an emptiness check).
  Seeding on the server instead of in each client means two browsers
  opening the same document cannot both insert the initial content — the
  client never bootstraps text itself.
- **Flush**: when the last client leaves, `writeState` persists the room.

## Durable CRDT state

The canonical Yjs document state is persisted in SQLite (`yjs_state`
table) as an opaque encoded update, alongside — not replaced by — the
plain-text `documents` table, which remains the user-facing
representation. When y-websocket creates a room, `bindRoomState` restores
it from the stored CRDT state; the plain-source seed is only the
migration path for documents that predate CRDT persistence, and the
stored CRDT state wins when both exist.

Every room update re-persists the full encoded state, debounced by ~1s
(documents are small; snapshotting beats an update log at this scale).
That means durability does not depend on a graceful shutdown or on the
last client leaving.

**One yjs module instance, ever.** `y-websocket/bin/utils` is CommonJS
and `require`s the CJS build of yjs; server code that manipulates room
docs must load yjs through `createRequire` so it gets that same instance
(`server/src/collaboration/state.ts` exports it). Importing the ESM
build alongside it puts structs from two class hierarchies into one
document (the "Yjs was already imported" warning) and corrupts sync
encoding — the symptom was clients silently diverging after a server
restart, with one client applying a remote delete but losing the
accompanying insert.

Persistence is hardened against faults: a corrupt or truncated state
blob falls back to the plain-text representation and is healed by the
next persist, and failures inside the persistence hooks or the debounce
timer are contained (a rejected `writeState` promise inside y-websocket
would otherwise crash the whole process as an unhandled rejection).

## Source resolution and export

Plain AsciiDoc is derived data, resolved in freshness order: live room
text (if a room is open), else decoded `yjs_state`, else the legacy
`documents.source` row. `GET /api/documents/:id` returns it, and
`GET /api/documents/:id/source` serves it as a `text/plain` `.adoc`
download for committing to Git. The `documents.source` column survives
only as a derived cache written by `persistRoom` — same write, same
content, no second truth.

## Connection state and offline editing

The topbar indicator now reflects the collaboration connection
(`Synced / Connecting… / Offline`) instead of HTTP save state: while
synced, edits reach the server in real time and the server persists
them. The accepted trade-off is that edits made while offline live only
in the open tab until reconnect (a local persistence layer such as
y-indexeddb would close that gap and can come later).

## Presence

Names, colors, cursors, selections, and online status live exclusively in
Yjs Awareness (`app/src/collaboration/presence.ts`). Awareness is
ephemeral by design: it travels over the same WebSocket but never becomes
part of the document, never reaches SQLite, and the server removes a
client's state the moment its socket closes — which is what makes the
connected-user indicator drop departed users immediately.

Each browser keeps one identity (generated adjective-animal name plus a
palette color) in `localStorage`, so a person keeps their name and color
across documents and visits; the topbar input renames it. The identity is
published as the awareness `user` field, exactly the shape
`y-codemirror.next` reads to draw remote carets (`.cm-ySelectionCaret`,
labeled with the name) and selections. The presence list rendering is a
pure function over the raw awareness states, unit-tested without any
networking.

The editor assembles its extensions by hand instead of using CodeMirror's
`basicSetup`, because `basicSetup` bundles CodeMirror's own history and
there must be exactly one undo system — the Yjs-aware one
(`yUndoManagerKeymap`).

## Document IDs

`server/src/documents/ids.ts` generates 80 random bits (`node:crypto`)
encoded as 14 base64url characters. IDs are stable, non-sequential, and
URL-safe, as the project instructions require. The ID is the document's only
identity; titles/filenames are not identities.

## Persistence

The storage boundary is `DocumentStore`
(`server/src/persistence/store.ts`): an asynchronous, domain-level
interface (documents + opaque Yjs state), never a generic SQL wrapper.
Two implementations exist and pass one shared behavioral contract suite
(`server/tests/store-contract.ts`):

- `server/src/persistence/sqlite.ts` — the built-in `node:sqlite`
  (`DatabaseSync`, WAL mode) for the Node target. Synchronous under the
  async interface; every direct `node:sqlite` use lives in this one
  module.
- `server/src/persistence/d1.ts` — Cloudflare D1 for the Worker
  target, tested against a real local D1 in workerd
  (`npm run test:workers`).

The schema comes from one numbered, immutable migration series in
`migrations/`, shared verbatim by both engines and applied by the local
runner (startup or `npm run db:migrate`) and by
`wrangler d1 migrations apply`. Both track applied files in the same
`d1_migrations` table. The database path comes from `ASCIIWEAVE_DB`;
tests use temp files and prove restart survival by closing and
reopening the store.

## Cloudflare Worker target

`server/src/worker/index.ts` is a second composition root over the same
`createApp` and codec. Two runtime-specific rules shape it:

- **One yjs build per runtime.** The Node server must use the CJS yjs
  instance y-websocket requires; the Worker bundles the ESM build. The
  shared code (`collaboration/codec.ts`, `collaboration/room-binding.ts`)
  therefore takes the yjs module as a parameter instead of importing it,
  and the Worker bundle never contains `node:sqlite` or `createRequire`.
- **One writer per document.** Where the Node target owns rooms in
  process memory, the Worker gives each document a `CollabRoom` Durable
  Object (`server/src/worker/room.ts`) speaking the y-websocket wire
  protocol (sync + awareness) over `WebSocketPair`. It restores from D1
  through the same corrupt-blob-tolerant `bindRoomState`, persists
  debounced snapshots to D1 — never every keystroke — and flushes when
  the last client leaves. The API's freshness rule (live room text over
  persisted state) holds because the Worker asks the document's Object
  for its current text.

Static assets are served by Workers Assets with SPA fallback; only
`/api/*` and `/collab/*` reach the Worker (`run_worker_first`).
Deployment, environments, and rollback:
[`deployment-cloudflare.md`](deployment-cloudflare.md).

## Stale-render prevention

Asciidoctor.js v4 conversion is asynchronous, and completions are not
guaranteed to arrive in submission order. `app/src/preview/scheduler.ts`
gives every started conversion a generation number and applies a result only
if no newer conversion has started since. Combined with a ~200 ms debounce,
rapid typing can never leave stale output on screen. The scheduler takes the
convert/apply functions as parameters so the ordering logic is unit-tested
without a real converter.

## Preview isolation

Document content is user-authored and treated as untrusted relative to the
application shell. The rendered HTML goes into an `<iframe sandbox srcdoc>`
with an empty sandbox attribute — neither `allow-scripts` nor
`allow-same-origin` — so document content cannot execute script in the
asciiweave origin. The Asciidoctor default stylesheet (vendored at
`app/src/preview/asciidoctor.css`, from `@asciidoctor/core`) is inlined into
the iframe document; application UI CSS is kept separate. Conversion runs
with Asciidoctor's default `secure` safe mode, so `include::` does not read
files.

## Serving model

During browser-app development, users open the app through Vite (whose SPA
fallback makes `/doc/<id>` load `index.html`), and Vite proxies `/api` and
`/collab` to the Node.js server. When `app/dist/index.html` exists, the Node.js
target serves the built assets itself and returns `index.html` for `/` and
`/doc/:id`. The Cloudflare target serves the same built assets through Workers
Assets. On either target, the client fetches the document and shows a
not-found page if the API returns 404.
