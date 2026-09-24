import { invoke } from "../commands/_shared.mjs";
import { normalizeBarcode } from "../ids.mjs";
import { searchRegion } from "../params.mjs";

function nutrient(raw, ...keys) {
  for (const key of keys) {
    const source = raw?.[key];
    if (source === null || source === undefined || source === "") continue;
    const value = Number(source);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

function normalizeYazioProduct(raw, id, { barcodes = [] } = {}) {
  if (!raw?.name || !raw?.base_unit) return null;
  const energy = nutrient(raw.nutrients, "energy.energy");
  const protein = nutrient(raw.nutrients, "nutrient.protein");
  const fat = nutrient(raw.nutrients, "nutrient.fat");
  const carb = nutrient(raw.nutrients, "nutrient.carb");
  if ([energy, protein, fat, carb].some((value) => value === null)) return null;
  const unit = String(raw.base_unit).toLowerCase();
  if (!["g", "ml", "piece"].includes(unit)) return null;
  return {
    id: `y::${id}`,
    document: {
      schema_version: 1,
      kind: "food",
      name: raw.name,
      aliases: [],
      brand: raw.producer ?? null,
      barcodes: [...new Set((raw.eans || barcodes).map(normalizeBarcode).filter(Boolean))],
      state: "unknown",
      basis: { amount: 1, unit },
      nutrients: {
        energy_kcal: energy,
        protein_g: protein,
        fat_g: fat,
        carb_g: carb,
        fiber_g: nutrient(raw.nutrients, "nutrient.fiber", "nutrient.dietaryfiber"),
      },
      other_nutrients: Object.fromEntries(Object.entries(raw.nutrients || {}).filter(([key, value]) =>
        !["energy.energy", "nutrient.protein", "nutrient.fat", "nutrient.carb", "nutrient.fiber", "nutrient.dietaryfiber"].includes(key)
          && typeof value === "number")),
      portions: (raw.servings || (raw.serving ? [{ serving: raw.serving, amount: raw.amount }] : []))
        .filter((portion) => portion?.serving && Number(portion.amount) > 0)
        .map((portion) => ({ name: portion.serving, amount: Number(portion.amount), unit })),
      category: raw.category ?? null,
      tags: [],
    },
    source: "yazio",
    external_id: id,
  };
}

export async function searchYazio(query, { limit = 10 } = {}) {
  const region = await searchRegion();
  const raw = await invoke("products.search", { query: { query, ...region } });
  return (Array.isArray(raw) ? raw : []).slice(0, limit).map((entry) =>
    normalizeYazioProduct(entry, entry.product_id)).filter(Boolean);
}

export async function getYazioProduct(externalId) {
  const raw = await invoke("products.get", { path: { id: externalId } });
  return raw ? normalizeYazioProduct(raw, externalId) : null;
}

export async function findYazioByBarcode(value, { limit = 10 } = {}) {
  const barcode = normalizeBarcode(value);
  if (!barcode) return [];
  const candidates = await searchYazio(barcode, { limit });
  const detailed = await Promise.all(candidates.map(async (candidate) => {
    try { return await getYazioProduct(candidate.external_id); } catch { return null; }
  }));
  return detailed.filter((candidate) => candidate?.document?.barcodes?.includes(barcode));
}
