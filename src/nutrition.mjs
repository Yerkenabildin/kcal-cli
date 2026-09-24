import { UsageError } from "./errors.mjs";
import { roundDeep } from "./util.mjs";

export const NUTRIENT_KEYS = ["energy_kcal", "protein_g", "fat_g", "carb_g", "fiber_g"];
export const FIBER_ALIASES = ["nutrient.fiber", "nutrient.dietaryfiber"];
export const UNITS = ["g", "ml", "piece"];

export function canonicalFiber(values) {
  for (const key of ["fiber_g", ...FIBER_ALIASES]) {
    const value = values?.[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

export function normalizeUnit(value, label = "unit") {
  const raw = String(value || "").trim().toLowerCase();
  const aliases = {
    gram: "g", grams: "g", грамм: "g", грамма: "g", граммов: "g",
    milliliter: "ml", millilitre: "ml", миллилитр: "ml", миллилитров: "ml",
    pcs: "piece", pc: "piece", item: "piece", штука: "piece", штук: "piece",
  };
  const unit = aliases[raw] || raw;
  if (!UNITS.includes(unit)) throw new UsageError(`${label} must be one of ${UNITS.join(", ")}; got: ${value}`);
  return unit;
}

export function assertCompatibleUnit(expected, actual) {
  const left = normalizeUnit(expected, "item basis unit");
  const right = normalizeUnit(actual, "--unit");
  if (left !== right) {
    throw new UsageError(`cannot convert ${right} to ${left} in v1`, {
      expected_unit: left,
      supplied_unit: right,
    });
  }
  return right;
}

export function normalizeNutrients(value, { requireCore = true } = {}) {
  const source = value && typeof value === "object" ? value : {};
  const result = {};
  for (const key of NUTRIENT_KEYS) {
    const raw = source[key];
    if (raw === null && key === "fiber_g") { result[key] = null; continue; }
    const number = Number(raw);
    if (!Number.isFinite(number) || number < 0) {
      if (!requireCore && raw === undefined) { result[key] = key === "fiber_g" ? null : 0; continue; }
      throw new UsageError(`${key} must be a non-negative number${key === "fiber_g" ? " or null" : ""}`);
    }
    result[key] = number;
  }
  return result;
}

export function scaleProfile(profile, amount, unit) {
  if (!profile) throw new UsageError("item has no nutrient profile");
  assertCompatibleUnit(profile.basis.unit, unit);
  const factor = Number(amount) / profile.basis.amount;
  if (!Number.isFinite(factor) || factor <= 0) throw new UsageError("amount must be greater than zero");
  const out = {};
  const fiber = canonicalFiber({ ...(profile.other_nutrients || {}), ...(profile.nutrients || {}) });
  for (const key of NUTRIENT_KEYS) {
    const value = key === "fiber_g" ? fiber : profile.nutrients[key];
    out[key] = value === null ? null : value * factor;
  }
  for (const [key, value] of Object.entries(profile.other_nutrients || {})) {
    if (FIBER_ALIASES.includes(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value * factor;
  }
  return roundDeep(out);
}

export function addNutrients(target, values) {
  for (const [key, value] of Object.entries(values || {})) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    target[key] = (target[key] || 0) + value;
  }
  return target;
}

export function emptyNutrients() {
  return { energy_kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0, fiber_g: 0 };
}
