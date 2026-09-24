import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kcal-service-"));
process.env.KCAL_DB_FILE = path.join(tmp, "kcal.sqlite3");
process.env.YAZIO_TOKEN_FILE = path.join(tmp, "yazio-token.json");
process.env.YAZIO_API_URL = "https://yazio.test";
process.env.KCAL_OFF_API_URL = "https://off.test";
process.env.YAZIO_RETRIES = "0";
fs.writeFileSync(process.env.YAZIO_TOKEN_FILE, JSON.stringify({
  access_token: "test-token",
  refresh_token: "refresh-token",
  expires_at: "2099-01-01T00:00:00.000Z",
  user: { sex: "male", country: "NL", food_database_country: "NL", language: "en" },
}));

const { closeDatabase, openDatabase } = await import("../src/db.mjs");
const { createFood, getItem } = await import("../src/catalog.mjs");
const { materializeItem, resolveInput, resolveItem, searchCatalog } = await import("../src/services/catalog-service.mjs");
const { AmbiguousMatchError } = await import("../src/errors.mjs");
const favoriteCommand = await import("../src/commands/favorite.mjs");
const itemCommand = await import("../src/commands/item.mjs");

const FOOD = {
  schema_version: 1,
  kind: "food",
  name: "Red lentils",
  aliases: ["lentils"],
  brand: null,
  barcodes: [],
  state: "dry",
  basis: { amount: 100, unit: "g" },
  nutrients: { energy_kcal: 350, protein_g: 25, fat_g: 2, carb_g: 55, fiber_g: 11 },
  portions: [],
  category: "legumes",
  tags: [],
};

const barcode = "8712345678905";
const offProduct = {
  code: barcode,
  product_name: "Barcode lentils OFF",
  brands: "OFF brand",
  nutriments: {
    "energy-kcal_100g": 330,
    proteins_100g: 24,
    fat_100g: 2,
    carbohydrates_100g: 54,
    fiber_100g: 10,
  },
};
const yazioProduct = {
  name: "Barcode lentils YAZIO",
  producer: "YAZIO brand",
  base_unit: "g",
  eans: [barcode],
  nutrients: {
    "energy.energy": 3.4,
    "nutrient.protein": 0.25,
    "nutrient.fat": 0.02,
    "nutrient.carb": 0.55,
    "nutrient.fiber": 0.1,
  },
};

const realFetch = globalThis.fetch;
let fetches;
let mode;

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${process.env.KCAL_DB_FILE}${suffix}`, { force: true });
  fetches = [];
  mode = "both";
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    fetches.push(url);
    const exactName = mode === "exact-both" ? "Exact lentils" : null;
    if (url.hostname === "off.test") {
      let product = exactName ? { ...offProduct, product_name: exactName } : offProduct;
      if (mode === "off-null-fiber") {
        product = { ...product, nutriments: { ...product.nutriments, fiber_100g: null } };
      }
      if (url.pathname.startsWith("/api/v2/product/")) return jsonResponse({ status: 1, product });
      return jsonResponse({ products: [product] });
    }
    if (mode === "yazio-fails") return jsonResponse({ error: "temporary" }, 503);
    if (url.pathname === "/v22/products/search") {
      const product = mode === "yazio-dietaryfiber"
        ? { ...yazioProduct, nutrients: { ...yazioProduct.nutrients, "nutrient.fiber": null, "nutrient.dietaryfiber": 0.07 } }
        : yazioProduct;
      return jsonResponse([{ ...product, ...(exactName ? { name: exactName } : {}), product_id: "yazio-product-id" }]);
    }
    if (url.pathname === "/v22/products/yazio-product-id") {
      return jsonResponse({ ...yazioProduct, ...(exactName ? { name: exactName } : {}) });
    }
    throw new Error(`unexpected URL: ${url}`);
  };
});

afterEach(() => { globalThis.fetch = realFetch; });

test("a local exact match stops before external providers", async () => {
  const db = openDatabase();
  const local = createFood(db, FOOD);
  const result = await searchCatalog(db, "lentils");
  assert.equal(result.items[0].id, local.id);
  assert.equal(fetches.length, 0);
});

test("barcode results rank Open Food Facts before YAZIO and search alone persists no item", async () => {
  const db = openDatabase();
  const result = await searchCatalog(db, barcode);
  assert.equal(result.items[0].id, `off::${barcode}`);
  assert.ok(result.items.some((item) => item.id === "y::yazio-product-id"));
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM items").get().count, 0);

  const saved = await materializeItem(db, `off::${barcode}`);
  assert.equal(saved.id, `off::${barcode}`);
  assert.equal(getItem(db, saved.id).id, saved.id);
});

test("one failed provider does not discard another provider's results", async () => {
  mode = "yazio-fails";
  const result = await searchCatalog(openDatabase(), "lentils");
  assert.equal(result.items[0].id, `off::${barcode}`);
  assert.equal(result.provider_errors[0].provider, "yazio");
});

test("YAZIO dietaryfiber is promoted to the canonical fiber field", async () => {
  mode = "yazio-dietaryfiber";
  const result = await searchCatalog(openDatabase(), "lentils");
  const item = result.items.find((candidate) => candidate.id === "y::yazio-product-id");
  assert.equal(item.nutrients.fiber_g, 0.07);
  const detail = await resolveItem(openDatabase(), item.id);
  assert.equal(detail.other_nutrients["nutrient.dietaryfiber"], undefined);
});

test("an explicit provider null is not silently normalized to zero fiber", async () => {
  mode = "off-null-fiber";
  const result = await searchCatalog(openDatabase(), "lentils");
  const item = result.items.find((candidate) => candidate.id === `off::${barcode}`);
  assert.equal(item.nutrients.fiber_g, null);
});

test("two local exact matches are ambiguous with exit code 5", async () => {
  const db = openDatabase();
  createFood(db, FOOD);
  createFood(db, { ...FOOD, name: "Green lentils", aliases: ["lentils"] });
  await assert.rejects(
    resolveInput(db, "lentils"),
    (error) => error instanceof AmbiguousMatchError && error.exitCode === 5 && error.details.candidates.length === 2,
  );
});

test("exact-name resolution uses the first non-empty provider tier", async () => {
  mode = "exact-both";
  const item = await resolveInput(openDatabase(), "Exact lentils");
  assert.equal(item.id, "y::yazio-product-id");
});

test("favorite add rolls external materialization back when the favorite write fails", async () => {
  const db = openDatabase();
  const ref = `off::${barcode}`;
  const candidate = {
    id: ref,
    source: "open_food_facts",
    external_id: barcode,
    document: {
      ...FOOD,
      name: "External favorite",
      barcodes: [barcode],
    },
  };
  db.prepare(`INSERT INTO external_cache(ref, source, external_id, payload_json, fetched_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
    ref, candidate.source, candidate.external_id, JSON.stringify(candidate),
    new Date().toISOString(), new Date(Date.now() + 60_000).toISOString(),
  );
  db.exec(`CREATE TRIGGER reject_favorite BEFORE INSERT ON favorites
    BEGIN SELECT RAISE(ABORT, 'favorite rejected'); END`);

  await assert.rejects(favoriteCommand.run(["add", ref], {}), /favorite rejected/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM items").get().count, 0);
});

test("item verify rolls external materialization back when verification fails", async () => {
  const db = openDatabase();
  const ref = `off::${barcode}`;
  const candidate = {
    id: ref,
    source: "open_food_facts",
    external_id: barcode,
    document: { ...FOOD, name: "External verification", barcodes: [barcode] },
  };
  db.prepare(`INSERT INTO external_cache(ref, source, external_id, payload_json, fetched_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
    ref, candidate.source, candidate.external_id, JSON.stringify(candidate),
    new Date().toISOString(), new Date(Date.now() + 60_000).toISOString(),
  );
  db.exec(`CREATE TRIGGER reject_verification BEFORE UPDATE OF verification ON items
    BEGIN SELECT RAISE(ABORT, 'verification rejected'); END`);

  await assert.rejects(itemCommand.run(["verify", ref], {}), /verification rejected/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM items").get().count, 0);
});
