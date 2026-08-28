-- Migration number: 0001 	 2026-08-28
-- Initial asciiweave schema, shared verbatim by local SQLite and D1.
-- This file is immutable: it has been applied to the staging D1
-- database. Schema changes go in a new numbered migration.

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE yjs_state (
  id TEXT PRIMARY KEY,
  state BLOB NOT NULL,
  updated_at TEXT NOT NULL
);
