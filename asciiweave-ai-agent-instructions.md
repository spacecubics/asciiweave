# asciiweave: Implementation Instructions for AI Agents

## Project goal

Build **asciiweave**, a HackMD-like collaborative web editor for AsciiDoc.

The primary workflow is:

1. Create an AsciiDoc document in the web application.
2. Give it a stable, shareable URL.
3. Multiple colleagues can eventually edit that same document in real time.
4. The left pane contains AsciiDoc source in CodeMirror 6.
5. The right pane contains live HTML rendered by Asciidoctor.js.
6. When the document is ready, a user can copy or download the `.adoc` source and commit it to a local Git repository.

Git integration is **not** part of asciiweave.

Do not try to build the complete product in one change. Implement the phases below in order. Each phase must be usable, reviewable, tested, and committed before moving to the next phase.

---

## Core design principles

### 1. AsciiDoc source is the document

The canonical user-authored content is plain AsciiDoc text.

Do not introduce a rich-text JSON format.
Do not convert the document into an editable AST.
Do not automatically rewrite or reformat the AsciiDoc source.

A user must always be able to obtain ordinary `.adoc` text suitable for committing to Git.

### 2. Rendering is derived state

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

Never make rendered HTML the canonical document.

### 3. Collaboration operates on text

When collaboration is introduced, synchronize the AsciiDoc source text.

Do not make Yjs understand AsciiDoc structure.
Do not synchronize the Asciidoctor AST.
Do not synchronize rendered HTML.

### 4. A URL identifies one document

URL-based document separation is a foundation of asciiweave, not a later feature.

Example:

```text
https://asciiweave.example/doc/7Gf3kP2x
https://asciiweave.example/doc/a9Qm4XsL
https://asciiweave.example/doc/J2c8NvPw
```

Each URL identifies one independent AsciiDoc document.

Document IDs must be stable and non-sequential. Use a sufficiently random URL-safe identifier.

Do not use the document title or filename as the primary identity.

### 5. Keep the phases isolated

Do not add Yjs during Phase 1.
Do not add networking during Phase 2.
Do not add accounts, comments, teams, Git integration, Teamtype, or Antora while implementing the first collaborative milestone.

Small steps are intentional.

---

# Target technology

Use:

- TypeScript
- CodeMirror 6
- Asciidoctor.js 4 via `@asciidoctor/core`
- Yjs, stable v13 generation
- `y-codemirror.next`
- `y-websocket`, stable Yjs v13-compatible generation
- a modern browser build system such as Vite
- a small server-side component for document creation and persistence

Avoid unnecessary framework complexity.

For the initial server, a small Node.js/TypeScript HTTP service with SQLite is sufficient unless the repository already has an established equivalent stack.

## Yjs package compatibility

As of August 2026, the upstream `y-codemirror.next` and `y-websocket` repositories explicitly state that most users should continue using the stable packages with **Yjs v13**. Their development branches are moving toward the newer Yjs v14 package family.

For this project:

```text
yjs v13
y-codemirror.next stable package
y-websocket stable package
```

Pin mutually compatible versions in the lock file.

Do not mix stable Yjs v13 packages with examples taken from development branches using packages such as `@y/y`, `@y/codemirror`, or `@y/websocket`.

---

# Phase 1: URL-based AsciiDoc live editor

## Objective

Build a useful single-user asciiweave application.

It should already have the basic HackMD interaction model:

```text
New document
     |
     v
/doc/<random-id>
     |
     +-----------------------------+
     |                             |
     v                             v
CodeMirror 6                Asciidoctor.js
source pane                 preview pane
```

There is no real-time collaboration yet.

## 1.1 Document URLs

Implement:

```text
GET  /
POST /api/documents
GET  /api/documents/:id
PUT  /api/documents/:id
GET  /doc/:id
```

The exact API structure may be adjusted if the chosen framework has a cleaner equivalent, but preserve the semantics.

Creating a document must:

1. generate a random, URL-safe document ID;
2. persist the initial AsciiDoc source;
3. redirect or navigate to `/doc/<id>`.

Visiting `/doc/<id>` must open that document.

Two different IDs must never share state.

Use a document record roughly equivalent to:

```text
Document
    id
    source
    created_at
    updated_at
```

A title field may be added if useful, but it is not required in Phase 1.

## 1.2 Persistence

Documents must survive a server restart.

For the first phase, SQLite is acceptable and preferred over inventing a distributed storage architecture.

Do not store files in Git.

Do not add GitHub or GitLab integration.

## 1.3 Editor layout

Desktop layout:

```text
+---------------------------+---------------------------+
|                           |                           |
| AsciiDoc source           | rendered preview          |
|                           |                           |
| CodeMirror 6              | Asciidoctor.js            |
|                           |                           |
+---------------------------+---------------------------+
```

The initial layout should be approximately 50/50.

A draggable divider is optional.
Do not delay Phase 1 for it.

On narrow screens, stacking panes or switching between panes is sufficient.

## 1.4 Source pane

Use CodeMirror 6.

Requirements:

- normal text editing;
- line numbers;
- search;
- undo/redo;
- line wrapping;
- correct resizing with the browser;
- Unicode and Japanese text work correctly;
- source text is preserved exactly.

Do not spend significant time implementing full AsciiDoc syntax highlighting yet.

Basic or no syntax highlighting is acceptable for Phase 1.

Initialize new documents with a short useful example:

```asciidoc
= Untitled Document

Start writing AsciiDoc here.
```

## 1.5 Preview pane

Use Asciidoctor.js 4.

Current v4 conversion uses the asynchronous named-export API:

```js
import { convert } from '@asciidoctor/core'

const html = await convert(source)
```

Debounce conversion by roughly 150 to 300 ms while typing.

Do not assume asynchronous conversions finish in submission order.

Prevent stale rendering:

```text
edit 17
  convert 17 starts

edit 18
  convert 18 starts

convert 18 finishes
  display 18

convert 17 finishes
  discard 17
```

A generation counter, cancellation mechanism, or equivalent solution is acceptable.

## 1.6 Preview isolation

Treat generated document HTML as untrusted relative to the application shell.

Prefer a dedicated sandboxed preview iframe using `srcdoc`, or another design that gives equivalent isolation.

Document content must not be able to execute arbitrary script in the parent asciiweave application context.

Keep preview CSS separate from application UI CSS.

Use the normal Asciidoctor visual style or a faithful equivalent.

## 1.7 Saving

Changes must be persisted automatically.

Do not issue an HTTP request for every keystroke.

Use a short save debounce.

The UI should make save state understandable, for example:

```text
Saving...
Saved
```

Do not implement revision history yet.

## Phase 1 acceptance criteria

Phase 1 is complete when:

1. `/` can create a new document;
2. new documents receive stable random URLs;
3. `/doc/<id>` loads the correct document;
4. two different document IDs remain isolated;
5. CodeMirror appears in the source pane;
6. Asciidoctor-rendered HTML appears in the preview pane;
7. editing updates the preview;
8. editing automatically persists the source;
9. documents survive a server restart;
10. rapid typing cannot cause stale preview output;
11. Japanese and general Unicode text are preserved correctly;
12. malformed or incomplete AsciiDoc cannot crash the application;
13. tests cover creation, routing, persistence, and preview updates.

Stop here. Review and commit before Phase 2.

---

# Phase 2: Introduce Yjs locally

## Objective

Replace the live document model with Yjs without adding networking.

The application should look almost identical to Phase 1.

Before:

```text
CodeMirror
    |
plain string
    |
Asciidoctor.js
```

After:

```text
      Y.Doc
        |
      Y.Text
      /    \
     /      \
CodeMirror   Asciidoctor.js
```

This phase separates CRDT integration from networking.

## 2.1 Yjs document

For each asciiweave document, create one `Y.Doc`.

Create one shared text object:

```js
const source = ydoc.getText('source')
```

Use `y-codemirror.next` to bind that `Y.Text` to CodeMirror 6.

The live canonical source in the browser is now `Y.Text`.

Do not also maintain another canonical copy in React state, a store, or another editor model.

## 2.2 Bootstrap from persisted Phase 1 content

When opening a document for the first time in Phase 2:

1. fetch its persisted Phase 1 source;
2. initialize the Yjs text once;
3. bind CodeMirror to the Yjs text;
4. render from the Yjs text.

Be careful not to insert the same initial source repeatedly.

## 2.3 Preview

Preview remains local:

```text
Y.Text.toString()
       |
       v
Asciidoctor.js
       |
       v
HTML preview
```

The preview system should not care whether a text change originated from CodeMirror or a programmatic Yjs transaction.

## 2.4 Undo and redo

Once CodeMirror is driven by Yjs, use the collaboration-aware undo/redo support supplied by the Yjs CodeMirror integration.

Do not keep two independent undo systems operating on the same text.

## 2.5 No networking yet

Do not add:

- `y-websocket`;
- Hocuspocus;
- WebRTC;
- multi-user presence;
- remote cursors;
- a collaboration server.

Phase 2 is intentionally a single-browser Yjs document.

## Phase 2 acceptance criteria

1. Phase 1 behavior remains intact.
2. All live source content is represented by `Y.Text`.
3. CodeMirror changes modify `Y.Text`.
4. Programmatic `Y.Text` changes appear in CodeMirror.
5. preview follows `Y.Text`.
6. undo/redo behaves correctly.
7. persisted documents can be opened without duplicating content.
8. there is still no network collaboration.

Add tests that modify `Y.Text` outside CodeMirror and verify convergence of editor text and preview.

Stop and commit.

---

# Phase 3: Minimum real-time multi-user editing

## Objective

Make two or more browsers editing the same asciiweave URL share the same source document in real time.

This is the first true collaborative milestone.

## 3.1 URL ID equals collaboration room ID

Use the existing asciiweave document ID as the Yjs room name.

Example:

```text
/doc/7Gf3kP2x
      |
      +---- Yjs room "7Gf3kP2x"

/doc/a9Qm4XsL
      |
      +---- Yjs room "a9Qm4XsL"
```

There should be no second independently generated collaboration ID.

## 3.2 Network provider

Attach a stable Yjs v13-compatible `y-websocket` provider to the `Y.Doc`.

Conceptually:

```js
const ydoc = new Y.Doc()

const provider = new WebsocketProvider(
  websocketUrl,
  documentId,
  ydoc
)

const source = ydoc.getText('source')
```

Use a small compatible WebSocket backend for the prototype.

The collaboration server must remain AsciiDoc-agnostic.

It transports Yjs document updates and awareness information. It does not render AsciiDoc.

## 3.3 Shared versus local state

Shared:

```text
AsciiDoc source
```

Local and derived:

```text
rendered HTML
editor viewport
local UI state
```

Each browser runs Asciidoctor.js locally against its synchronized `Y.Text`.

Do not transmit generated HTML between collaborators.

## 3.4 Test actual concurrency

Do not test only sequential editing.

Test at least:

### Different positions

Client A edits near the beginning while Client B edits near the end.

Both must converge.

### Same position

Clients insert different content at the same logical location.

All clients must converge to identical final text.

The exact deterministic ordering selected by Yjs is not an asciiweave requirement.

### Delete versus insert

One client deletes while another inserts in or around that region.

All clients must converge.

### Temporary disconnection

1. connect A and B;
2. disconnect B;
3. edit A;
4. edit B while disconnected;
5. reconnect B;
6. verify convergence.

### Room isolation

Clients connected to different asciiweave document URLs must not receive each other's updates.

## Phase 3 acceptance criteria

1. two browsers opening the same `/doc/<id>` collaborate in real time;
2. changes appear remotely without manual refresh;
3. simultaneous edits converge;
4. reconnecting clients converge;
5. different document IDs remain isolated;
6. each client renders preview locally;
7. the collaboration backend contains no AsciiDoc-specific editing logic.

At this point asciiweave is a minimum viable multi-user collaborative AsciiDoc editor.

Stop and have humans use it before adding substantial product features.

---

# Phase 4: Presence and durable collaborative state

## Objective

Turn the collaboration prototype into a dependable shared service.

Implement this phase in small sub-phases.

## 4.1 Awareness and cursors

Use Yjs Awareness and the support available through `y-codemirror.next`.

Add:

- collaborator display name;
- collaborator color;
- remote cursor;
- remote selection;
- connected-user indicator.

Awareness is ephemeral.

Do not persist cursor position, active selection, or online status as part of the AsciiDoc document.

## 4.2 Durable Yjs state

The collaboration server's in-memory room state is not sufficient for production use.

Persist the canonical Yjs document state using a supported persistence mechanism.

Do not assume that storing only plain AsciiDoc text is equivalent to persisting Yjs collaborative state.

Plain `.adoc` export remains important, but it is a representation of the current document for users, not a replacement for CRDT persistence.

## 4.3 Reconcile Phase 1 persistence

Once durable Yjs persistence is reliable, simplify the earlier Phase 1 source persistence model.

There should eventually be one authoritative collaborative state, not two competing stores that can diverge.

Expose current plain AsciiDoc source for download/export as derived data from that collaborative state.

## Phase 4 acceptance criteria

1. a collaborative document survives service restart;
2. all users reconnect to the same content;
3. remote cursors and selections appear;
4. presence disappears correctly when users disconnect;
5. durable CRDT state does not depend on a user keeping a browser open.

---

# Phase 5: Productization

Only start these after the first four phases are stable and have been tested by real asciiweave users.

Potential features include:

- authentication;
- read/write permissions;
- document ownership;
- document list;
- recent documents;
- document title;
- public/private sharing;
- revision history and named snapshots;
- comments;
- copy source;
- download `.adoc`;
- better AsciiDoc syntax highlighting;
- source/preview scroll synchronization;
- resizable panes;
- document outline;
- keyboard configuration;
- expanded Emacs-style CodeMirror bindings;
- images and attachments;
- `include::` support;
- `xref` navigation;
- Antora-aware preview;
- Teamtype integration;
- native Emacs collaboration;
- native VS Code collaboration;
- operational monitoring;
- backups;
- scaling.

These are candidates, not an instruction to implement them all.

Each substantial feature should be requested and reviewed separately.

---

# Explicit non-goals through Phase 4

Do not implement:

- Git integration;
- GitHub integration;
- GitLab integration;
- automatic commits;
- repository checkout;
- Antora site generation;
- Markdown editing;
- WYSIWYG editing;
- custom CRDT algorithms;
- custom OT algorithms;
- AsciiDoc-aware CRDT operations;
- AI writing features;
- organizations or billing;
- Teamtype integration;
- native-editor collaboration.

The initial product is intentionally:

```text
stable document URL
+
CodeMirror 6
+
plain AsciiDoc
+
Asciidoctor.js preview
+
Yjs collaboration
```

---

# Suggested repository structure

Keep the structure simple. For example:

```text
asciiweave/
  package.json
  package-lock.json
  README.md

  app/
    src/
      editor/
      preview/
      documents/
      collaboration/
      routes/
    tests/

  server/
    src/
      documents/
      persistence/
      collaboration/
    tests/

  docs/
    architecture.md
```

A monorepo is not mandatory. Adapt this to the chosen framework, but keep browser editing/rendering concerns separate from server persistence/collaboration concerns.

---

# Testing expectations

Automated tests should cover behavior, not just component existence.

At minimum test:

## Phase 1

- creating a document returns a unique ID;
- document URLs remain stable;
- documents survive server restart;
- editing one document cannot modify another;
- source updates preview;
- stale asynchronous rendering is rejected;
- Unicode and Japanese text round-trip correctly.

## Phase 2

- CodeMirror and `Y.Text` stay synchronized;
- programmatic Yjs changes reach the editor;
- preview reflects remote-style Yjs transactions;
- undo/redo remains correct.

## Phase 3

Use two independent browser contexts or equivalent real clients.

Test:

- concurrent insert/insert;
- insert/delete;
- disconnect/edit/reconnect;
- convergence;
- room isolation.

Do not substitute unit tests of mocked WebSocket calls for at least one real multi-client integration test.

## Phase 4

Test:

- service restart;
- CRDT state restoration;
- presence cleanup;
- reconnect after restart.

---

# Security notes for the early implementation

AsciiDoc is authored by users, so treat rendered output as potentially hostile.

Do not allow preview HTML to execute arbitrary JavaScript in the asciiweave application origin.

Use preview isolation and appropriate Content Security Policy where practical.

Do not implement arbitrary server-side `include::` access to the server filesystem in the early phases.

If includes are added later, explicitly design the resource and path security model first.

Do not expose sequential document IDs.

---

# Work discipline for AI agents

When assigned a phase:

1. inspect the current repository before changing architecture;
2. implement only the requested phase;
3. avoid speculative abstractions for future phases;
4. keep dependencies minimal;
5. pin dependency versions;
6. add or update tests;
7. run formatter, linter, type checker, unit tests, and integration tests;
8. document commands required to run the result;
9. describe architectural decisions that are not obvious from the code;
10. do not silently add features from later phases.

If an upstream API differs from these instructions, check current upstream documentation before changing the intended architecture.

Do not work around an API mismatch by implementing a custom synchronization algorithm.

---

# First task for an implementation agent

Implement **Phase 1 only**.

Deliver:

1. the asciiweave application;
2. a minimal persistent document backend;
3. stable random `/doc/<id>` URLs;
4. CodeMirror 6 source editing;
5. live Asciidoctor.js preview;
6. automatic saving;
7. tests;
8. a concise README with development and test commands.

Do not add Yjs yet.

The Phase 1 architecture should be no more complicated than:

```text
                  asciiweave

       POST /api/documents
                |
                v
          random document ID
                |
                v
          /doc/<document-id>
                |
        +-------+--------+
        |                |
        v                v
   CodeMirror 6     Asciidoctor.js
        |                |
        |                v
        |           HTML preview
        |
        v
  debounced persistence
        |
        v
   document backend
```

After Phase 1 is reviewed and accepted, Phase 2 introduces Yjs locally. Phase 3 then adds the network provider and real multi-user collaboration.

---

# Verified upstream references

These references were checked on 2026-08-27.

- CodeMirror documentation: https://codemirror.net/docs/
- CodeMirror basic editor example: https://codemirror.net/examples/basic/
- Asciidoctor.js documentation: https://docs.asciidoctor.org/asciidoctor.js/latest/
- Asciidoctor.js v4 migration guide: https://docs.asciidoctor.org/asciidoctor.js/latest/setup/migration-guide/
- Asciidoctor.js quick tour: https://docs.asciidoctor.org/asciidoctor.js/latest/setup/quick-tour/
- Yjs CodeMirror 6 binding: https://github.com/yjs/y-codemirror.next
- Yjs WebSocket provider: https://github.com/yjs/y-websocket

## Current upstream facts relevant to implementation

- Asciidoctor.js 4 is a native JavaScript implementation that runs in Node.js and browsers.
- Its main parsing and conversion entry points are asynchronous.
- `convert` is available as a named export from `@asciidoctor/core`.
- `y-codemirror.next` binds a Yjs `Y.Text` to CodeMirror 6 and supports awareness-driven remote cursors/selections and Yjs-aware undo/redo.
- The current upstream `y-codemirror.next` and `y-websocket` repositories advise most users to stay on their stable Yjs v13-compatible packages while their development branches transition toward the Yjs v14 package family.
- `y-websocket` uses a room name plus a `Y.Doc`, which maps naturally to asciiweave's `/doc/<id>` model.
