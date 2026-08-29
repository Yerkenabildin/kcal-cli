// yazio product <productId> [--amount N]
//
// One product's full detail: serving options, barcodes, and its complete nutrient breakdown.
// This is the only place a barcode can actually be confirmed — search results carry no `eans`.
import { UsageError } from "../errors.mjs";
import { groupNutrients, perAmount, perHundred } from "../normalize.mjs";
import { roundDeep, toNumber, toStringFlag } from "../util.mjs";
import { invoke } from "./_shared.mjs";

export const knownFlags = new Set(["amount", "barcode"]);

export async function run(positionals, flags) {
  const id = positionals[0];
  if (!id) throw new UsageError("usage: yazio product <productId> [--amount N]");

  const detail = await fetchProduct(id);
  if (!detail) throw new UsageError(`no product found with id ${id}`);

  const amount = flags.amount === undefined ? null : toNumber(flags.amount, "--amount", { exclusiveMin: 0 });
  const barcode = toStringFlag(flags.barcode, "--barcode");

  const shaped = shapeProduct(detail);
  if (amount !== null) {
    shaped.for_amount = { amount, base_unit: detail.base_unit, nutrients: perAmount(detail.nutrients, amount) };
  }
  if (barcode) {
    // Exact string equality, not a contains or a normalisation: a barcode that nearly matches
    // is a different product, and treating it as this one silently logs the wrong food.
    shaped.barcode_check = {
      barcode,
      matches: (detail.eans ?? []).includes(barcode),
      known_barcodes: detail.eans ?? [],
    };
  }
  return roundDeep(shaped);
}

// The response body carries no id of its own, so the requested one is folded back in —
// everything downstream reads a product as a self-contained object.
export async function fetchProduct(id) {
  const detail = await invoke("products.get", { path: { id } });
  return detail ? { id, ...detail } : null;
}

export function shapeProduct(detail) {
  return {
    ok: true,
    operation: "product",
    product_id: detail.id,
    name: detail.name,
    producer: detail.producer ?? null,
    base_unit: detail.base_unit,
    is_verified: Boolean(detail.is_verified),
    is_private: Boolean(detail.is_private),
    is_deleted: Boolean(detail.is_deleted),
    category: detail.category ?? null,
    barcodes: detail.eans ?? [],
    servings: detail.servings ?? [],
    countries: detail.countries ?? [],
    language: detail.language ?? null,
    updated_at: detail.updated_at ?? null,
    // Both views, because losing the raw one is how a factor-of-100 error becomes invisible.
    per_100: perHundred(detail.nutrients),
    per_base_unit: groupNutrients(detail.nutrients),
  };
}
