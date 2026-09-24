import { test } from "node:test";
import assert from "node:assert/strict";

import { createId, normalizeBarcode, parseId } from "../src/ids.mjs";
import { assertCompatibleUnit, scaleProfile } from "../src/nutrition.mjs";
import { validateProduct, validateRecipe } from "../src/schemas.mjs";

test("compound IDs retain their public origin", () => {
  for (const prefix of ["l", "r", "y", "off", "scan"]) {
    const id = prefix === "off" ? "off::8712345678905" : createId(prefix);
    assert.equal(parseId(id).prefix, prefix);
  }
  assert.equal(parseId(createId("e")), null, "entry IDs are not item IDs");
  assert.equal(parseId(createId("e"), { allowEntry: true }).prefix, "e");
  assert.equal(normalizeBarcode("8712 3456-78905"), "8712345678905");
});

test("product schema requires active core nutrition and preserves other nutrients", () => {
  const product = {
    schema_version: 1,
    kind: "food",
    name: "Milk",
    basis: { amount: 100, unit: "ml" },
    nutrients: { energy_kcal: 50, protein_g: 3, fat_g: 2, carb_g: 5, fiber_g: null },
    other_nutrients: { calcium_mg: 120, source_note: "label" },
  };
  validateProduct(product);
  assert.deepEqual(product.aliases, []);
  assert.equal(product.other_nutrients.calcium_mg, 120);
  assert.throws(() => validateProduct({
    ...structuredClone(product),
    nutrients: { energy_kcal: 50, protein_g: 3, fat_g: 2, fiber_g: null },
  }), /does not match schema/);
});

test("recipe schema and nutrient scaling reject invalid units", () => {
  assert.throws(() => validateRecipe({
    schema_version: 1,
    kind: "recipe",
    name: "Empty",
    ingredients: [],
    yield: { amount: 100, unit: "g" },
  }), /does not match schema/);
  assert.throws(() => assertCompatibleUnit("g", "ml"), /cannot convert/);
  const scaled = scaleProfile({
    basis: { amount: 100, unit: "g" },
    nutrients: { energy_kcal: 250, protein_g: 10, fat_g: 5, carb_g: 40, fiber_g: null },
    other_nutrients: { sodium_mg: 300 },
  }, 40, "g");
  assert.equal(scaled.energy_kcal, 100);
  assert.equal(scaled.sodium_mg, 120);
  assert.equal(scaled.fiber_g, null);
});
