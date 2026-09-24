import { openDatabase } from "../db.mjs";
import { UsageError } from "../errors.mjs";
import { toInt } from "../util.mjs";
import { searchCatalog } from "../services/catalog-service.mjs";

export const knownFlags = new Set(["limit"]);

export async function run(positionals, flags) {
  const query = positionals.join(" ").trim();
  if (!query) throw new UsageError("usage: kcal search <query> [--limit 10]");
  const limit = flags.limit === undefined ? 10 : toInt(flags.limit, "--limit", { min: 1, max: 50 });
  const db = openDatabase({ create: false });
  const result = await searchCatalog(db, query, { limit });
  return { ok: true, operation: "search", ...result, returned: result.items.length };
}
