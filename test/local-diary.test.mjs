import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kcal-diary-"));
process.env.KCAL_DB_FILE = path.join(tmp, "kcal.sqlite3");

const { closeDatabase, openDatabase } = await import("../src/db.mjs");
const { createFood, getItem, toProductDocument, updateFood } = await import("../src/catalog.mjs");
const {
  addDiaryEntry, diaryTotals, readDay, removeDiaryEntry, setGoals, updateDiaryEntry,
} = await import("../src/local-diary.mjs");

const FOOD = {
  schema_version: 1, kind: "food", name: "Milk", aliases: ["my milk"], brand: null,
  barcodes: [], state: "as_sold", basis: { amount: 100, unit: "ml" },
  nutrients: { energy_kcal: 50, protein_g: 3, fat_g: 2, carb_g: 5, fiber_g: 0 },
  other_nutrients: {}, portions: [], category: "dairy", tags: [],
};

beforeEach(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${process.env.KCAL_DB_FILE}${suffix}`, { force: true });
});

test("diary add resolves an exact alias, snapshots nutrients, and is idempotent with op-key", async () => {
  const db = openDatabase();
  const food = createFood(db, FOOD);
  const first = await addDiaryEntry(db, "my milk", {
    amount: 200, unit: "ml", meal: "breakfast", date: "2026-09-24", opKey: "breakfast-milk",
  });
  const repeat = await addDiaryEntry(db, food.id, {
    amount: 200, unit: "ml", meal: "breakfast", date: "2026-09-24", opKey: "breakfast-milk",
  });
  assert.equal(first.entry.nutrients.energy_kcal, 100);
  assert.equal(repeat.entry.id, first.entry.id);
  assert.equal(repeat.already_logged, true);
  assert.equal(readDay(db, "2026-09-24").entry_count, 1);
});

test("catalog changes do not rewrite diary nutrient snapshots", async () => {
  const db = openDatabase();
  const food = createFood(db, FOOD);
  await addDiaryEntry(db, food.id, { amount: 100, unit: "ml", meal: "snack", date: "2026-09-24" });
  const changed = toProductDocument(food);
  changed.nutrients.energy_kcal = 70;
  updateFood(db, food.id, changed);
  assert.equal(readDay(db, "2026-09-24").totals.energy_kcal, 50);
});

test("entry updates preserve the snapshot basis and removals remain in the revision ledger", async () => {
  const db = openDatabase();
  const food = createFood(db, FOOD);
  const added = await addDiaryEntry(db, food.id, { amount: 100, unit: "ml", meal: "snack", date: "2026-09-24" });
  const updated = updateDiaryEntry(db, added.entry.id, { amount: 250, meal: "dinner" });
  assert.equal(updated.entry.nutrients.energy_kcal, 125);
  assert.equal(updated.entry.meal, "dinner");
  removeDiaryEntry(db, added.entry.id);
  assert.equal(readDay(db, "2026-09-24").entry_count, 0);
  assert.deepEqual(
    db.prepare("SELECT action FROM diary_entry_revisions WHERE entry_id=? ORDER BY id").all(added.entry.id).map((row) => row.action),
    ["create", "update", "remove"],
  );
});

test("day output includes goals and range totals fill empty dates", async () => {
  const db = openDatabase();
  const food = createFood(db, FOOD);
  setGoals(db, { energy: 2000, protein: 100, fat: 70, carb: 250, fiber: 30 });
  await addDiaryEntry(db, food.id, { amount: 200, unit: "ml", meal: "breakfast", date: "2026-09-24" });
  const day = readDay(db, "2026-09-24");
  assert.equal(day.remaining.energy_kcal, 1900);
  const range = diaryTotals(db, "2026-09-23", "2026-09-24");
  assert.equal(range.days.length, 2);
  assert.equal(range.days[0].logged, false);
  assert.equal(range.days[1].energy_kcal, 100);
});

test("unknown fiber keeps day and range totals usable but marks them incomplete", async () => {
  const db = openDatabase();
  const known = createFood(db, {
    ...FOOD,
    name: "Beans",
    basis: { amount: 100, unit: "g" },
    nutrients: { ...FOOD.nutrients, fiber_g: 7 },
  });
  const unknown = createFood(db, {
    ...FOOD,
    name: "Jalapeno",
    basis: { amount: 100, unit: "g" },
    nutrients: { ...FOOD.nutrients, fiber_g: null },
  });
  setGoals(db, { fiber: 30 });
  await addDiaryEntry(db, known.id, { amount: 100, unit: "g", meal: "lunch", date: "2026-09-24" });
  await addDiaryEntry(db, unknown.id, { amount: 20, unit: "g", meal: "lunch", date: "2026-09-24" });

  const day = readDay(db, "2026-09-24");
  assert.equal(day.totals.fiber_g, 7);
  assert.deepEqual(day.incomplete_nutrients, ["fiber_g"]);
  assert.equal(day.remaining.fiber_g, null);

  const range = diaryTotals(db, "2026-09-24", "2026-09-24");
  assert.equal(range.days[0].fiber_g, 7);
  assert.deepEqual(range.days[0].incomplete_nutrients, ["fiber_g"]);
  assert.equal(range.averages.fiber_g, 7);
  assert.deepEqual(range.incomplete_nutrients, ["fiber_g"]);
});

test("legacy dietaryfiber snapshots contribute to canonical diary totals", async () => {
  const db = openDatabase();
  const food = createFood(db, {
    ...FOOD,
    name: "Kidney beans",
    basis: { amount: 100, unit: "g" },
    nutrients: { ...FOOD.nutrients, fiber_g: null },
    other_nutrients: { "nutrient.dietaryfiber": 7 },
  });
  const added = await addDiaryEntry(db, food.id, { amount: 100, unit: "g", meal: "lunch", date: "2026-09-24" });
  assert.equal(getItem(db, food.id).nutrients.fiber_g, 7);
  db.prepare("UPDATE diary_entries SET nutrients_json=? WHERE id=?").run(
    JSON.stringify({ ...added.entry.nutrients, fiber_g: null, "nutrient.dietaryfiber": 7 }),
    added.entry.id,
  );

  const day = readDay(db, "2026-09-24");
  assert.equal(day.totals.fiber_g, 7);
  assert.deepEqual(day.incomplete_nutrients, []);
});

test("external materialization rolls back when a diary entry is invalid", async () => {
  const db = openDatabase();
  const externalId = "off::8712345678905";
  const external = {
    id: externalId,
    source: "open_food_facts",
    external_id: "8712345678905",
    document: { ...FOOD, name: "External milk", barcodes: ["8712345678905"] },
  };
  db.prepare(`INSERT INTO external_cache(ref, source, external_id, payload_json, fetched_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
    externalId, external.source, external.external_id, JSON.stringify(external),
    new Date().toISOString(), new Date(Date.now() + 60_000).toISOString(),
  );

  await assert.rejects(addDiaryEntry(db, externalId, {
    amount: 100, unit: "g", meal: "lunch", date: "2026-09-24",
  }), /cannot convert/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM items").get().count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM diary_entries").get().count, 0);
});
