import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DB_FILE } from "./config.mjs";

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('food', 'recipe')),
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        brand TEXT,
        state TEXT NOT NULL DEFAULT 'unknown'
          CHECK (state IN ('as_sold', 'dry', 'cooked', 'prepared', 'unknown')),
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'needs_review', 'archived')),
        verification TEXT NOT NULL DEFAULT 'unverified'
          CHECK (verification IN ('unverified', 'verified')),
        category TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        provenance_type TEXT NOT NULL DEFAULT 'manual',
        external_source TEXT,
        external_id TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS items_external_ref
        ON items(external_source, external_id)
        WHERE external_source IS NOT NULL AND external_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS items_normalized_name ON items(normalized_name);

      CREATE TABLE IF NOT EXISTS item_aliases (
        item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        alias TEXT NOT NULL,
        normalized_alias TEXT NOT NULL,
        PRIMARY KEY (item_id, normalized_alias)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS aliases_normalized ON item_aliases(normalized_alias);

      CREATE TABLE IF NOT EXISTS barcodes (
        item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        barcode TEXT NOT NULL,
        PRIMARY KEY (item_id, barcode)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS barcodes_value ON barcodes(barcode);

      CREATE TABLE IF NOT EXISTS nutrients (
        item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
        basis_amount REAL NOT NULL CHECK (basis_amount > 0),
        basis_unit TEXT NOT NULL CHECK (basis_unit IN ('g', 'ml', 'piece')),
        energy_kcal REAL NOT NULL CHECK (energy_kcal >= 0),
        protein_g REAL NOT NULL CHECK (protein_g >= 0),
        fat_g REAL NOT NULL CHECK (fat_g >= 0),
        carb_g REAL NOT NULL CHECK (carb_g >= 0),
        fiber_g REAL CHECK (fiber_g IS NULL OR fiber_g >= 0),
        other_json TEXT NOT NULL DEFAULT '{}'
      ) STRICT;

      CREATE TABLE IF NOT EXISTS portions (
        id INTEGER PRIMARY KEY,
        item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        amount REAL NOT NULL CHECK (amount > 0),
        unit TEXT NOT NULL CHECK (unit IN ('g', 'ml', 'piece')),
        UNIQUE(item_id, name)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS recipes (
        item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
        yield_amount REAL NOT NULL CHECK (yield_amount > 0),
        yield_unit TEXT NOT NULL CHECK (yield_unit IN ('g', 'ml', 'piece'))
      ) STRICT;

      CREATE TABLE IF NOT EXISTS recipe_ingredients (
        recipe_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        ingredient_id TEXT NOT NULL REFERENCES items(id),
        amount REAL NOT NULL CHECK (amount > 0),
        unit TEXT NOT NULL CHECK (unit IN ('g', 'ml', 'piece')),
        PRIMARY KEY (recipe_id, position)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS recipe_ingredient_ref ON recipe_ingredients(ingredient_id);

      CREATE TABLE IF NOT EXISTS favorites (
        item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS diary_entries (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL REFERENCES items(id),
        item_version INTEGER NOT NULL,
        name_snapshot TEXT NOT NULL,
        amount REAL NOT NULL CHECK (amount > 0),
        unit TEXT NOT NULL CHECK (unit IN ('g', 'ml', 'piece')),
        meal TEXT NOT NULL CHECK (meal IN ('breakfast', 'lunch', 'dinner', 'snack')),
        logged_at TEXT NOT NULL,
        entry_date TEXT NOT NULL,
        nutrients_json TEXT NOT NULL,
        op_key TEXT UNIQUE,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS diary_by_date ON diary_entries(entry_date, meal, logged_at);
      CREATE INDEX IF NOT EXISTS diary_by_item ON diary_entries(item_id, entry_date);

      CREATE TABLE IF NOT EXISTS diary_entry_revisions (
        id INTEGER PRIMARY KEY,
        entry_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('create', 'update', 'remove')),
        snapshot_json TEXT NOT NULL,
        changed_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS revisions_entry ON diary_entry_revisions(entry_id, id);

      CREATE TABLE IF NOT EXISTS goals (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        energy_kcal REAL,
        protein_g REAL,
        fat_g REAL,
        carb_g REAL,
        fiber_g REAL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS scan_results (
        id TEXT PRIMARY KEY,
        image_sha256 TEXT NOT NULL,
        source_path TEXT NOT NULL,
        barcode_payload TEXT,
        hint TEXT,
        model TEXT,
        status TEXT NOT NULL CHECK (status IN ('active', 'needs_review')),
        result_json TEXT NOT NULL,
        warnings_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS external_cache (
        ref TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        external_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS operations (
        op_key TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
        id UNINDEXED,
        name,
        aliases,
        brand,
        tokenize = 'unicode61 remove_diacritics 2'
      );
    `,
  },
];

let connection = null;

export function databasePath() {
  return DB_FILE;
}

export function databaseExists() {
  return fs.existsSync(DB_FILE);
}

export function openDatabase({ create = true } = {}) {
  if (connection) return connection;
  if (!create && !databaseExists()) return null;
  if (create) fs.mkdirSync(path.dirname(DB_FILE), { recursive: true, mode: 0o700 });
  connection = new Database(DB_FILE, { timeout: 5000, fileMustExist: !create });
  connection.pragma("foreign_keys = ON");
  connection.pragma("journal_mode = WAL");
  migrate(connection);
  return connection;
}

function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  ) STRICT`);
  const applied = new Set(db.prepare("SELECT version FROM schema_migrations").all().map((row) => row.version));
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
        .run(migration.version, new Date().toISOString());
    })();
  }
}

export function closeDatabase() {
  if (!connection) return;
  connection.close();
  connection = null;
}

export function withTransaction(db, fn) {
  return db.transaction(fn)();
}

export function refreshItemFts(db, itemId) {
  db.prepare("DELETE FROM items_fts WHERE id = ?").run(itemId);
  const item = db.prepare("SELECT id, name, brand, status FROM items WHERE id = ?").get(itemId);
  if (!item || item.status === "archived") return;
  const aliases = db.prepare("SELECT alias FROM item_aliases WHERE item_id = ? ORDER BY alias")
    .all(itemId).map((row) => row.alias).join(" ");
  db.prepare("INSERT INTO items_fts(id, name, aliases, brand) VALUES (?, ?, ?, ?)")
    .run(item.id, item.name, aliases, item.brand || "");
}
