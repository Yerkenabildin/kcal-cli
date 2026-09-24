import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kcal-db-"));
process.env.KCAL_DB_FILE = path.join(tmp, "kcal.sqlite3");

const { closeDatabase, openDatabase } = await import("../src/db.mjs");

beforeEach(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${process.env.KCAL_DB_FILE}${suffix}`, { force: true });
});

test("the first write-side open applies each migration exactly once", () => {
  let db = openDatabase();
  assert.deepEqual(db.prepare("SELECT version FROM schema_migrations ORDER BY version").all(), [{ version: 1 }]);
  closeDatabase();
  db = openDatabase();
  assert.deepEqual(db.prepare("SELECT version FROM schema_migrations ORDER BY version").all(), [{ version: 1 }]);
});

test("foreign keys and WAL are enabled on every connection", () => {
  const db = openDatabase();
  assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
  assert.equal(db.pragma("journal_mode", { simple: true }), "wal");
  assert.throws(() => db.prepare(`INSERT INTO favorites(item_id, created_at)
    VALUES ('l::missing', '2026-09-24T00:00:00.000Z')`).run(), /FOREIGN KEY/);
});
