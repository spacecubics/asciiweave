# asciiweave architecture (Phase 3)

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
- **Flush**: when the last client leaves, `writeState` writes the room's
  text back to SQLite. Clients still autosave over HTTP as in Phase 1;
  the flush only narrows the window for losing final edits. One
  authoritative collaborative store is Phase 4.3's job.

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
