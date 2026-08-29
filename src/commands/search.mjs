// yazio search <query|EAN> [--limit N] [--countries NL] [--locales nl_NL,en_NL]
//
// Free text or a barcode — the API takes both through the same `query` parameter, so there is
// no separate barcode command. A barcode match still has to be confirmed against the product's
// own `eans`, which a search result does not carry: use `yazio product <id>` for that.
import { UsageError } from "../errors.mjs";
import { perHundred } from "../normalize.mjs";
import { searchRegion } from "../params.mjs";
import { roundDeep, toInt, toStringFlag } from "../util.mjs";
import { invoke } from "./_shared.mjs";

export const knownFlags = new Set(["limit", "countries", "locales", "barcode", "verified"]);

export async function run(positionals, flags) {
  const barcode = toStringFlag(flags.barcode, "--barcode");
  const query = (barcode || positionals.join(" ")).trim();
  if (!query) throw new UsageError("usage: yazio search <query>   (a barcode works too)");

  const limit = flags.limit === undefined ? 10 : toInt(flags.limit, "--limit", { min: 1, max: 50 });
  const region = await searchRegion({
    countries: toStringFlag(flags.countries, "--countries"),
    locales: toStringFlag(flags.locales, "--locales"),
  });

  const results = await invoke("products.search", { query: { query, ...region } });
  const all = Array.isArray(results) ? results : [];
  const wanted = flags.verified ? all.filter((r) => r.is_verified) : all;

  return roundDeep({
    ok: true,
    operation: "search",
    query,
    searched_as_barcode: Boolean(barcode),
    region,
    total_matches: all.length,
    returned: Math.min(wanted.length, limit),
    products: wanted.slice(0, limit).map(shapeResult),
  });
}

export function shapeResult(result) {
  return {
    product_id: result.product_id,
    name: result.name,
    producer: result.producer ?? null,
    is_verified: Boolean(result.is_verified),
    base_unit: result.base_unit,
    // What the app would log if you tapped this result without changing anything.
    default_serving: result.serving
      ? { serving: result.serving, quantity: result.serving_quantity ?? 1, amount: result.amount ?? null }
      : null,
    // A search result's nutrients are per base unit, the same as a product detail's. Presented
    // per 100 because that is the number on a package, and named so it cannot be misread.
    per_100: perHundred(result.nutrients),
    countries: result.countries ?? [],
    language: result.language ?? null,
    score: result.score ?? null,
  };
}
