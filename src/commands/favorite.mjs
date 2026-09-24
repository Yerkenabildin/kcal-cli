import { addFavorite, listFavorites, removeFavorite } from "../catalog.mjs";
import { openDatabase, withTransaction } from "../db.mjs";
import { UsageError } from "../errors.mjs";
import { toStringFlag } from "../util.mjs";
import { materializeResolvedItem, resolveItem } from "../services/catalog-service.mjs";

export const knownFlags = new Set(["alias"]);

export async function run(positionals, flags) {
  const sub = positionals[0];
  const db = openDatabase({ create: sub !== "list" });
  if (sub === "list") return { ok: true, operation: "favorite.list", items: listFavorites(db) };
  const id = positionals[1];
  if (!id || !["add", "remove"].includes(sub)) throw new UsageError("usage: kcal favorite <add|remove|list> [item-id]");
  if (sub === "add") {
    const candidate = await resolveItem(db, id);
    if (!candidate) throw new UsageError(`no item found with id ${id}`);
    const result = withTransaction(db, () => {
      materializeResolvedItem(db, candidate);
      return addFavorite(db, id, toStringFlag(flags.alias, "--alias"));
    });
    return { ok: true, operation: "favorite.add", ...result };
  }
  return { ok: true, operation: "favorite.remove", ...removeFavorite(db, id) };
}
