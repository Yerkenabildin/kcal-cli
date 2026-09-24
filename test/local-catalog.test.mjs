import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kcal-catalog-"));
process.env.KCAL_DB_FILE = path.join(tmp, "kcal.sqlite3");

const { closeDatabase, openDatabase } = await import("../src/db.mjs");
const {
  addFavorite, createFood, createRecipe, getItem, searchLocal, updateRecipe,
} = await import("../src/catalog.mjs");
const { UsageError } = await import("../src/errors.mjs");
const recipeCommand = await import("../src/commands/recipe.mjs");

const FOOD = {
  schema_version: 1,
  kind: "food",
  name: "Red lentils, dry",
  aliases: ["lentils"],
  brand: null,
  barcodes: ["12345670"],
  state: "dry",
  basis: { amount: 100, unit: "g" },
  nutrients: { energy_kcal: 350, protein_g: 25, fat_g: 2, carb_g: 55, fiber_g: 11 },
  other_nutrients: {},
  portions: [{ name: "cup", amount: 190, unit: "g" }],
  category: "legumes",
  tags: [],
};

beforeEach(() => {
  closeDatabase();
  fs.rmSync(process.env.KCAL_DB_FILE, { force: true });
  fs.rmSync(`${process.env.KCAL_DB_FILE}-wal`, { force: true });
  fs.rmSync(`${process.env.KCAL_DB_FILE}-shm`, { force: true });
});

test("a food is persisted with a stable compound id and searchable aliases", () => {
  const db = openDatabase();
  const food = createFood(db, FOOD);
  assert.match(food.id, /^l::[0-9a-f-]+$/);
  assert.equal(food.per_100.energy_kcal, 350);
  assert.equal(searchLocal(db, "lentils")[0].id, food.id);
  assert.equal(searchLocal(db, "12345670")[0].match, "barcode");
});

test("favorites affect ranking without turning every item into a favorite", () => {
  const db = openDatabase();
  const first = createFood(db, { ...FOOD, name: "Lentils A", aliases: ["lentils"] });
  const second = createFood(db, { ...FOOD, name: "Lentils B", aliases: ["lentils"], barcodes: [] });
  addFavorite(db, second.id, "my lentils");
  const results = searchLocal(db, "lentils");
  assert.equal(results[0].id, second.id);
  assert.equal(getItem(db, first.id).favorite, false);
  assert.equal(searchLocal(db, "my lentils")[0].id, second.id);
});

test("nested recipes calculate nutrients from their current ingredients", () => {
  const db = openDatabase();
  const food = createFood(db, FOOD);
  const base = createRecipe(db, {
    schema_version: 1,
    kind: "recipe",
    name: "Cooked lentils",
    aliases: [],
    ingredients: [{ item_id: food.id, amount: 200, unit: "g" }],
    yield: { amount: 500, unit: "g" },
    portions: [],
    tags: [],
  });
  const meal = createRecipe(db, {
    schema_version: 1,
    kind: "recipe",
    name: "Lentil meal",
    aliases: [],
    ingredients: [{ item_id: base.id, amount: 250, unit: "g" }],
    yield: { amount: 250, unit: "g" },
    portions: [],
    tags: [],
  });
  assert.equal(getItem(db, meal.id).nutrients.energy_kcal, 350);
  assert.equal(getItem(db, meal.id).per_100.energy_kcal, 140);
});

test("a recipe update that introduces a cycle is rejected and rolled back", () => {
  const db = openDatabase();
  const food = createFood(db, FOOD);
  const first = createRecipe(db, {
    schema_version: 1, kind: "recipe", name: "First", aliases: [],
    ingredients: [{ item_id: food.id, amount: 100, unit: "g" }],
    yield: { amount: 100, unit: "g" }, portions: [], tags: [],
  });
  const second = createRecipe(db, {
    schema_version: 1, kind: "recipe", name: "Second", aliases: [],
    ingredients: [{ item_id: first.id, amount: 100, unit: "g" }],
    yield: { amount: 100, unit: "g" }, portions: [], tags: [],
  });
  assert.throws(() => updateRecipe(db, first.id, {
    schema_version: 1, kind: "recipe", name: "First", aliases: [],
    ingredients: [{ item_id: second.id, amount: 100, unit: "g" }],
    yield: { amount: 100, unit: "g" }, portions: [], tags: [],
  }), UsageError);
  assert.equal(getItem(db, first.id).ingredients[0].item_id, food.id);
});

test("external ingredient materialization rolls back when recipe validation fails", async () => {
  const db = openDatabase();
  const externalId = "off::8712345678905";
  const external = {
    id: externalId,
    source: "open_food_facts",
    external_id: "8712345678905",
    document: { ...FOOD, name: "External lentils", barcodes: ["8712345678905"] },
  };
  db.prepare(`INSERT INTO external_cache(ref, source, external_id, payload_json, fetched_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
    externalId, external.source, external.external_id, JSON.stringify(external),
    new Date().toISOString(), new Date(Date.now() + 60_000).toISOString(),
  );
  const recipeFile = path.join(tmp, "invalid-recipe.json");
  fs.writeFileSync(recipeFile, JSON.stringify({
    schema_version: 1,
    kind: "recipe",
    name: "Invalid soup",
    aliases: [],
    ingredients: [{ item_id: externalId, amount: 100, unit: "ml" }],
    yield: { amount: 100, unit: "ml" },
    portions: [],
    tags: [],
  }));

  await assert.rejects(recipeCommand.run(["create"], { file: recipeFile }), /cannot convert/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM items").get().count, 0);
});
