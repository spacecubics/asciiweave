# asciiweave architecture (Phase 1)

Decisions that are not obvious from the code alone.

## Overall shape

```
POST /api/documents  ->  random ID  ->  /doc/<id>
                                          |
                              +-----------+-----------+
                              |                       |
                        CodeMirror 6           Asciidoctor.js
                              |                       |
                     debounced PUT /api        sandboxed iframe
                              |
                        SQLite (node:sqlite)
```

The AsciiDoc source string is the canonical document. Rendered HTML is
derived, disposable state and is never persisted or sent to the server.

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
