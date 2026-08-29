// YAZIO returns nutrients as one flat map with dotted keys — `energy.energy`,
// `nutrient.protein`, `mineral.calcium`, `vitamin.b12` — around forty of them on a full
// product. Nothing is dropped here; the grouping only makes the shape self-describing so a
// reader can tell macros from micronutrients without knowing YAZIO's key vocabulary.
//
// Energy is kilocalories and every other nutrient is grams. Macros stay in grams; minerals and
// vitamins are converted to milligrams on the way out, because in grams they are values like
// 0.00012 that any downstream rounding reports as a flat zero — which reads as "contains none"
// rather than "too small to show".
const GROUPS = { nutrient: "macros", mineral: "minerals", vitamin: "vitamins" };
const MACRO_ORDER = ["carb", "protein", "fat"];
const UNITS = { macros: ["g", 1], minerals: ["mg", 1000], vitamins: ["mg", 1000], other: ["g", 1] };

export function groupNutrients(raw) {
  // An empty map returns an empty object rather than a bare `{units:{}}`: a product with no
  // nutrients recorded should read as absent, not as a shape with nothing in it.
  if (!raw || typeof raw !== "object" || Object.keys(raw).length === 0) return {};
  const grouped = { macros: {}, minerals: {}, vitamins: {}, other: {} };
  let energyKcal = null;

  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "number" || !Number.isFinite(value)) { grouped.other[key] = value; continue; }
    const dot = key.indexOf(".");
    const prefix = dot === -1 ? "" : key.slice(0, dot);
    const name = dot === -1 ? "" : key.slice(dot + 1);
    if (key === "energy.energy") energyKcal = value;
    else if (name && GROUPS[prefix]) grouped[GROUPS[prefix]][name] = value;
    // Keys that do not follow `prefix.name`, or use a prefix we do not know, are preserved
    // verbatim: the spec was inferred from traffic, so new nutrient families are expected.
    else grouped.other[key] = value;
  }

  const units = {};
  const result = { units };
  if (energyKcal !== null) { units.energy = "kcal"; result.energy_kcal = energyKcal; }
  if (Object.keys(grouped.macros).length) {
    units.macros = UNITS.macros[0];
    result.macros = ordered(convert(grouped.macros, "macros"), MACRO_ORDER);
  }
  for (const group of ["minerals", "vitamins", "other"]) {
    if (!Object.keys(grouped[group]).length) continue;
    units[group] = UNITS[group][0];
    result[group] = sortKeys(convert(grouped[group], group));
  }
  return result;
}

function convert(values, group) {
  const factor = UNITS[group][1];
  if (factor === 1) return values;
  const out = {};
  for (const [key, value] of Object.entries(values)) {
    out[key] = typeof value === "number" ? value * factor : value;
  }
  return out;
}

function ordered(values, first) {
  const leading = {};
  for (const key of first) if (key in values) leading[key] = values[key];
  const trailing = {};
  for (const key of Object.keys(values).sort()) if (!(key in leading)) trailing[key] = values[key];
  return { ...leading, ...trailing };
}

function sortKeys(values) {
  const out = {};
  for (const key of Object.keys(values).sort()) out[key] = values[key];
  return out;
}

// Multiply every numeric nutrient by a factor, keeping the flat dotted keys. This is the one
// place a per-base-unit value becomes a per-portion or per-100 one, so a factor-of-100 error
// has exactly one place to hide.
export function scaleNutrients(raw, factor) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value * factor;
  }
  return out;
}

// The nutrients a label prints. YAZIO stores per one gram or millilitre, so this is a plain
// ×100 — kept as a named function rather than an inline literal because it is the conversion
// most likely to be written the wrong way round.
export function perHundred(raw) {
  return groupNutrients(scaleNutrients(raw, 100));
}

export function perAmount(raw, amount) {
  return groupNutrients(scaleNutrients(raw, amount));
}

// A search result's nutrients are per base unit too, exactly like a product detail's — despite
// the community MCP server naming that field `nutrients_per_serving`. Checked against the live
// API: "Egg" comes back as 1.55 with a 60 g `whole` serving, which is 93 kcal per egg and
// 1.55 kcal per gram, not 1.55 per serving. Anything that treats a search result as
// per-serving is off by the serving size.
