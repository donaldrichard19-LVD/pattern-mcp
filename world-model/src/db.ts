import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type DB = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, current_version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY, model_id TEXT NOT NULL, type TEXT NOT NULL, label TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL DEFAULT '', text TEXT NOT NULL, source_date TEXT NOT NULL, ingested_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY, model_id TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', owner TEXT NOT NULL DEFAULT '',
  confidence TEXT NOT NULL DEFAULT 'medium', flags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS nodes_model ON nodes(model_id);
CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY, model_id TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL,
  type TEXT NOT NULL, confidence TEXT NOT NULL DEFAULT 'medium',
  UNIQUE(from_id, to_id, type)
);
CREATE INDEX IF NOT EXISTS edges_model ON edges(model_id);
CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY, model_id TEXT NOT NULL, node_ids TEXT NOT NULL, source_id TEXT,
  quote TEXT NOT NULL, span_start INTEGER, span_end INTEGER, source_date TEXT NOT NULL,
  source_type TEXT NOT NULL, stance TEXT NOT NULL DEFAULT 'supports', actor TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS evidence_model ON evidence(model_id);
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY, model_id TEXT NOT NULL, batch_id TEXT, actor TEXT NOT NULL, actor_type TEXT NOT NULL,
  change_type TEXT NOT NULL, payload TEXT NOT NULL, rationale TEXT NOT NULL DEFAULT '',
  source_ref TEXT NOT NULL DEFAULT 'null', status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by TEXT, review_note TEXT, conflicts TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL, reviewed_at TEXT, seq INTEGER
);
CREATE INDEX IF NOT EXISTS proposals_model ON proposals(model_id, status);
CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY, model_id TEXT NOT NULL, number INTEGER NOT NULL, changelog TEXT NOT NULL,
  created_at TEXT NOT NULL, UNIQUE(model_id, number)
);
`;

export function openDb(path = process.env.WM_DB ?? "data/world-model.db"): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}

/** Run fn inside a transaction; roll back on throw. Nested calls join the outer transaction. */
const depth = new WeakMap<DB, number>();
export function tx<T>(db: DB, fn: () => T): T {
  const d = depth.get(db) ?? 0;
  if (d > 0) return fn();
  db.exec("BEGIN");
  depth.set(db, 1);
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    depth.set(db, 0);
  }
}
