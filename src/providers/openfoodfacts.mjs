import { OFF_API_URL, OFF_USER_AGENT } from "../config.mjs";
import { normalizeBarcode } from "../ids.mjs";
import { fetchJson } from "./http.mjs";

function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function firstName(product) {
  return product?.product_name || product?.product_name_en || product?.generic_name || null;
}

function normalizeOffProduct(product) {
  const code = normalizeBarcode(product?.code || product?._id);
  const nutriments = product?.nutriments || {};
  const energy = number(nutriments["energy-kcal_100g"] ?? nutriments.energy_kcal_100g);
  const protein = number(nutriments.proteins_100g);
  const fat = number(nutriments.fat_100g);
  const carb = number(nutriments.carbohydrates_100g);
  const name = firstName(product);
  if (!code || !name || [energy, protein, fat, carb].some((value) => value === null)) return null;
  const unit = String(product.product_quantity_unit || "g").toLowerCase() === "ml" ? "ml" : "g";
  const portions = [];
  const servingAmount = number(product.serving_quantity);
  if (servingAmount) portions.push({ name: product.serving_size || "serving", amount: servingAmount, unit });
  return {
    id: `off::${code}`,
    document: {
      schema_version: 1,
      kind: "food",
      name,
      aliases: [],
      brand: product.brands || null,
      barcodes: [code],
      state: "as_sold",
      basis: { amount: 100, unit },
      nutrients: {
        energy_kcal: energy,
        protein_g: protein,
        fat_g: fat,
        carb_g: carb,
        fiber_g: number(nutriments.fiber_100g),
      },
      other_nutrients: Object.fromEntries(Object.entries(nutriments).filter(([key, value]) =>
        key.endsWith("_100g") && typeof value === "number"
          && !["energy-kcal_100g", "energy_kcal_100g", "proteins_100g", "fat_100g", "carbohydrates_100g", "fiber_100g"].includes(key))),
      portions,
      category: Array.isArray(product.categories_tags) ? product.categories_tags[0] || null : null,
      tags: [],
    },
    source: "open_food_facts",
    external_id: code,
  };
}

function headers() {
  return { Accept: "application/json", "User-Agent": OFF_USER_AGENT };
}

export async function getOffProduct(value) {
  const barcode = normalizeBarcode(value);
  if (!barcode) return null;
  const url = new URL(`/api/v2/product/${encodeURIComponent(barcode)}.json`, OFF_API_URL);
  url.searchParams.set("fields", [
    "code", "product_name", "product_name_en", "generic_name", "brands", "nutriments",
    "serving_size", "serving_quantity", "product_quantity_unit", "categories_tags",
  ].join(","));
  const payload = await fetchJson(url, { headers: headers() });
  if (payload?.status === 0 || !payload?.product) return null;
  return normalizeOffProduct({ code: barcode, ...payload.product });
}

export async function searchOff(query, { limit = 10 } = {}) {
  const barcode = normalizeBarcode(query);
  if (barcode) {
    const product = await getOffProduct(barcode);
    return product ? [product] : [];
  }
  const url = new URL("/cgi/search.pl", OFF_API_URL);
  url.searchParams.set("search_terms", query);
  url.searchParams.set("search_simple", "1");
  url.searchParams.set("action", "process");
  url.searchParams.set("json", "1");
  url.searchParams.set("page_size", String(Math.min(limit, 20)));
  url.searchParams.set("fields", "code,product_name,product_name_en,generic_name,brands,nutriments,serving_size,serving_quantity,product_quantity_unit,categories_tags");
  const payload = await fetchJson(url, { headers: headers() });
  return (Array.isArray(payload?.products) ? payload.products : []).map(normalizeOffProduct).filter(Boolean).slice(0, limit);
}
