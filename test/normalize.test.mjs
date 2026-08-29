import { test } from "node:test";
import assert from "node:assert/strict";
import { groupNutrients, perAmount, perHundred, scaleNutrients } from "../src/normalize.mjs";

// Real values from the live API: "Egg" is 1.55 kcal and 0.13 g protein per gram, which is
// 93 kcal per 60 g egg and 13 g protein per 100 g. Anything that reads these as per-100 or
// per-serving is out by two orders of magnitude or by the serving size.
const EGG_PER_BASE_UNIT = {
  "energy.energy": 1.55,
  "nutrient.protein": 0.13,
  "nutrient.carb": 0.011,
  "nutrient.fat": 0.106,
};

test("nutrients are grouped and their units stated", () => {
  const grouped = groupNutrients(EGG_PER_BASE_UNIT);
  assert.equal(grouped.energy_kcal, 1.55);
  assert.deepEqual(grouped.units, { energy: "kcal", macros: "g" });
  assert.deepEqual(Object.keys(grouped.macros), ["carb", "protein", "fat"], "YAZIO's own macro order");
});

test("per 100 is exactly a factor of 100 from the base unit", () => {
  const per100 = perHundred(EGG_PER_BASE_UNIT);
  assert.equal(per100.energy_kcal, 155);
  assert.equal(per100.macros.protein, 13);
});

test("an amount scales linearly from the base unit, not from per-100", () => {
  const for150g = perAmount(EGG_PER_BASE_UNIT, 150);
  assert.equal(Math.round(for150g.energy_kcal), 233);
  assert.equal(Math.round(for150g.macros.protein * 10) / 10, 19.5);
});

test("scaling by 1 changes nothing, scaling by 0 zeroes everything", () => {
  assert.deepEqual(scaleNutrients(EGG_PER_BASE_UNIT, 1), EGG_PER_BASE_UNIT);
  assert.equal(scaleNutrients(EGG_PER_BASE_UNIT, 0)["energy.energy"], 0);
});

test("minerals and vitamins are reported in milligrams so they do not round to zero", () => {
  const grouped = groupNutrients({ "mineral.calcium": 0.056, "vitamin.b12": 0.0000014 });
  assert.equal(grouped.units.minerals, "mg");
  assert.equal(grouped.minerals.calcium, 56);
  assert.equal(grouped.units.vitamins, "mg");
  assert.ok(grouped.vitamins.b12 > 0, "a vitamin must not vanish into zero");
});

test("an unrecognised nutrient family is preserved rather than dropped", () => {
  const grouped = groupNutrients({ "energy.energy": 1, "somethingnew.x": 2, plain: 3 });
  assert.equal(grouped.other["somethingnew.x"], 2);
  assert.equal(grouped.other.plain, 3);
});

test("a non-numeric value is kept as-is instead of poisoning the arithmetic", () => {
  const grouped = groupNutrients({ "nutrient.protein": "n/a", "energy.energy": 1 });
  assert.equal(grouped.other["nutrient.protein"], "n/a");
  assert.equal(grouped.energy_kcal, 1);
  assert.ok(!Number.isNaN(scaleNutrients({ "nutrient.protein": "n/a" }, 2)["nutrient.protein"]));
});

test("an empty or missing nutrient map is empty, not a crash", () => {
  assert.deepEqual(groupNutrients(null), {});
  assert.deepEqual(groupNutrients({}), {});
  assert.deepEqual(scaleNutrients(undefined, 100), {});
});

test("energy is never converted: the API stores kcal and so do we", () => {
  const grouped = groupNutrients({ "energy.energy": 52 });
  assert.equal(grouped.energy_kcal, 52);
  assert.equal(grouped.units.energy, "kcal");
});
