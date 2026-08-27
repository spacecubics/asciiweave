# asciiweave architecture (Phase 4.3)

Decisions that are not obvious from the code alone.

## Overall shape

```
POST /api/documents  ->  random ID  ->  /doc/<id>
                                          |
   browser A                              |                    browser B
     Y.Doc  <---- ws://…/collab/<id> ---- + ---- ws://… ---->    Y.Doc
       |               (Yjs room)                                  |
     Y.Text                                                     Y.Text
     /    \                                                     /    \
CodeMirror  Asciidoctor.js                             CodeMirror  Asciidoctor.js
                 |                                                      |
debounced PUT   sandboxed iframe                        debounced PUT  sandboxed iframe
      |
SQLite (node:sqlite)
```

The AsciiDoc source string is the canonical document. Rendered HTML is
derived, disposable state: every browser converts its own synchronized
`Y.Text` locally, and HTML is never persisted or transmitted.

## Yjs document model

The live source in the browser is a `Y.Text` (`ydoc.getText('source')`),
bound to CodeMirror 6 with `y-codemirror.next`'s `yCollab` — there is no
second canonical copy in any store or editor model. The preview and the
autosaver subscribe to the `Y.Text` observer, so they react identically to
keystrokes, programmatic transactions, and remote collaborators' edits.

The `Y.UndoManager` does not track the provider's transaction origin, so
undo reverts only this user's own edits — never remote edits or the
content loaded from the server.

## Collaboration transport (Phase 3)

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

## Durable CRDT state (Phase 4.2)

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
last client leaving — the restart e2e test SIGKILLs the server
mid-session and both clients reconverge on reconnect.

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
`server/tests/durability.test.ts` fuzzes this layer with seeded random
mixed-script edits, restore chains, and multi-peer divergence;
`e2e/durability.spec.ts` SIGKILLs a real server repeatedly, mid-typing,
and against a pre-CRDT legacy database.

## One authoritative store (Phase 4.3)

The durable Yjs state is the single authoritative document store, and
the collaboration path is its only writer. The Phase 1 client-side HTTP
autosave (`PUT /api/documents/:id`) is gone — it was a second,
competing writer that could diverge from the collaborative state. New
documents get CRDT state at creation time (`POST` encodes the template
into `yjs_state`), so plain-text seeding now only serves databases from
before CRDT persistence.

Plain AsciiDoc is derived data, resolved in freshness order: live room
text (if a room is open), else decoded `yjs_state`, else the legacy
`documents.source` row. `GET /api/documents/:id` returns it, and
`GET /api/documents/:id/source` serves it as a `text/plain` `.adoc`
download for committing to Git. The `documents.source` column survives
only as a derived cache written by `persistRoom` — same write, same
content, no second truth.

The topbar indicator now reflects the collaboration connection
(`Synced / Connecting… / Offline`) instead of HTTP save state: while
synced, edits reach the server in real time and the server persists
them. The accepted trade-off is that edits made while offline live only
in the open tab until reconnect (a local persistence layer such as
y-indexeddb would close that gap and can come later).

## Presence (Phase 4.1)

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
(`yUndoManagerKeymap`). `main.ts` exposes `window.__asciiweave` as a test
hook so integration tests can apply Yjs transactions from outside the
editor and verify convergence.

## Document IDs

`server/src/documents/ids.ts` generates 80 random bits (`node:crypto`)
encoded as 14 base64url characters. IDs are stable, non-sequential, and
URL-safe, as the project instructions require. The ID is the document's only
identity; titles/filenames are not identities.

## Persistence

`server/src/persistence/db.ts` wraps the built-in `node:sqlite`
(`DatabaseSync`, WAL mode). `node:sqlite` is still marked experimental, so
every direct use of it lives in this one module behind the `DocumentStore`
interface — swapping to `better-sqlite3` or similar would touch only this
file. The database path comes from `ASCIIWEAVE_DB`; tests use temp files and
prove restart survival by closing and reopening the store.

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

## Autosave

`app/src/documents/save.ts` debounces PUTs (~750 ms), coalesces edits made
while a save is in flight, and retries failures with the newest source. A
`pagehide` listener flushes unsaved changes with a keepalive fetch. Save
state is surfaced as `Saving… / Saved / Save failed (retrying)`.

## Serving model

In development, Vite serves the app (SPA fallback makes `/doc/<id>` load
`index.html`) and proxies `/api` to the Node server. In production, the Node
server (Hono) serves the built `app/dist` assets itself and returns
`index.html` for `/` and `/doc/:id`; the client fetches the document and
shows a not-found page if the API returns 404.
