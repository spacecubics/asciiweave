# Requirements

This document defines the behavior asciiweave must preserve. Implementation
decisions belong in `architecture.md`; verification strategy and commands
belong in `testing.md`.

## Documents and editing

- `POST /api/documents` creates a document with a random ID and authoritative
  CRDT state containing the initial template.
- `GET /api/documents/<id>` returns the current source together with the
  document ID, revision, and timestamps.
- `/doc/<id>` opens the document, and different IDs never share state.
- CodeMirror supports ordinary editing, line numbers, search, Yjs-aware
  undo/redo, line wrapping, resizing, Unicode, and Japanese text.
- Source text is preserved exactly.
- The split source/preview layout remains usable on desktop and narrow screens.
- `GET /api/documents/<id>/source` exports current source as a `.adoc` file.
- Document read and source-export requests for unknown IDs return `404`.

## Collaboration and persistence

- Browsers on the same document URL converge in real time over WebSockets.
- Browsers on different document URLs never receive each other's updates.
- Each document room has one writer: the Node process locally or a Durable
  Object on Cloudflare.
- Durable state does not depend on a graceful shutdown or an open browser.
- Reconnecting clients converge after disconnection and server restart.
- Stored CRDT state wins over the legacy plain-text fallback.
- Persistence errors and corrupt stored updates must not crash the service.

## Presence

- Display names, colors, remote cursors, selections, and connected-user state
  use Yjs Awareness.
- Awareness is ephemeral and must never be stored as document content.
- A disconnected user's presence disappears promptly.

## Preview

- Preview rendering follows every `Y.Text` change, regardless of whether the
  transaction is local, programmatic, or remote.
- Stale asynchronous conversions must never replace newer output.
- Treat rendered document content as untrusted. Keep it in the sandboxed
  iframe without `allow-scripts` or `allow-same-origin`.
- Do not allow arbitrary server-side `include::` access to the filesystem.
