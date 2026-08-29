import { test } from "node:test";
import assert from "node:assert/strict";
import { shapeResult } from "../src/commands/search.mjs";
import { shapeProduct } from "../src/commands/product.mjs";

// Shapes taken from live responses.
const SEARCH_RESULT = {
  score: 110, name: "Magere Franse kwark", product_id: "a2790a72-becf-11e6-9939-e0071b8a8723",
  serving: "portion", serving_quantity: 1, amount: 150, base_unit: "g", producer: "Ah Kwark",
  is_verified: false, countries: ["NL"], language: "nl",
  nutrients: { "energy.energy": 0.52, "nutrient.carb": 0.04, "nutrient.protein": 0.09, "nutrient.fat": 0 },
};

const PRODUCT = {
  id: "75eb5707-ebeb-4eae-9187-74538d9edaf1", name: "Egg", producer: null, base_unit: "g",
  is_verified: false, is_private: false, is_deleted: false, category: "bakingingredients",
  eans: ["8712345678905"], servings: [{ serving: "whole", amount: 60 }],
  countries: ["NL"], language: "en", updated_at: "2026-01-01T00:00:00Z",
  nutrients: { "energy.energy": 1.55, "nutrient.protein": 0.13 },
};

test("a search result is presented per 100, the number a package prints", () => {
  const shaped = shapeResult(SEARCH_RESULT);
  assert.equal(shaped.per_100.energy_kcal, 52);
  assert.equal(shaped.per_100.macros.protein, 9);
});

test("a search result's nutrients are per base unit, not per serving", () => {
  // The community MCP server calls this field `nutrients_per_serving`. It is not: this result's
  // default serving is 150 g, and 0.52 is the per-gram value, not the value for the portion.
  const shaped = shapeResult(SEARCH_RESULT);
  assert.equal(shaped.default_serving.amount, 150);
  assert.notEqual(shaped.per_100.energy_kcal, 0.52);
  assert.equal(shaped.per_100.energy_kcal, 52);
});

test("the default serving is carried through so a portion can be logged without a second call", () => {
  assert.deepEqual(shapeResult(SEARCH_RESULT).default_serving, { serving: "portion", quantity: 1, amount: 150 });
});

test("a result with no serving reports none rather than inventing one", () => {
  assert.equal(shapeResult({ ...SEARCH_RESULT, serving: null }).default_serving, null);
});

test("a product keeps both the raw per-base-unit view and the per-100 one", () => {
  const shaped = shapeProduct(PRODUCT);
  assert.equal(shaped.per_base_unit.energy_kcal, 1.55);
  assert.equal(shaped.per_100.energy_kcal, 155);
});

test("a product exposes its barcodes and servings, which a search result cannot", () => {
  const shaped = shapeProduct(PRODUCT);
  assert.deepEqual(shaped.barcodes, ["8712345678905"]);
  assert.deepEqual(shaped.servings, [{ serving: "whole", amount: 60 }]);
});

test("the requested id is folded in, since the response body carries none", () => {
  assert.equal(shapeProduct(PRODUCT).product_id, "75eb5707-ebeb-4eae-9187-74538d9edaf1");
});

test("a product with no barcodes reports an empty list, not null", () => {
  assert.deepEqual(shapeProduct({ ...PRODUCT, eans: undefined }).barcodes, []);
});
