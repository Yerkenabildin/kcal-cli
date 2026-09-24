import { createFood, createRecipe, getItem, toProductDocument, updateRecipe } from "../catalog.mjs";
import { openDatabase, withTransaction } from "../db.mjs";
import { UsageError } from "../errors.mjs";
import { validateRecipe } from "../schemas.mjs";
import { toStringFlag } from "../util.mjs";
import { resolveItem } from "../services/catalog-service.mjs";
import { readJsonInput } from "./_io.mjs";

export const knownFlags = new Set(["file"]);

export async function run(positionals, flags) {
  const sub = positionals[0];
  const db = openDatabase({ create: sub !== "show" });
  if (sub === "show") {
    const item = getItem(db, positionals[1]);
    if (!item || item.kind !== "recipe") throw new UsageError(`no recipe found with id ${positionals[1]}`);
    return { ok: true, operation: "recipe.show", item };
  }
  if (!["create", "update"].includes(sub)) throw new UsageError("usage: kcal recipe <create|update|show> [id] --file recipe.json");
  const id = sub === "update" ? positionals[1] : null;
  if (sub === "update" && !id) throw new UsageError("usage: kcal recipe update <recipe-id> --file recipe.json");
  const doc = await readJsonInput(toStringFlag(flags.file, "--file"), "--file");
  validateRecipe(doc);
  const pending = [];
  for (const ingredient of doc.ingredients) {
    if (getItem(db, ingredient.item_id)) continue;
    const external = await resolveItem(db, ingredient.item_id);
    if (!external) throw new UsageError(`ingredient does not exist: ${ingredient.item_id}`);
    if (external.status === "needs_review") {
      throw new UsageError(`ingredient needs review: ${ingredient.item_id}`);
    }
    pending.push(external);
  }
  const item = withTransaction(db, () => {
    for (const external of pending) {
      if (getItem(db, external.id)) continue;
      createFood(db, toProductDocument(external), {
        id: external.id,
        provenanceType: external.provenance?.type,
        externalSource: external.provenance?.source,
        externalId: external.provenance?.external_id,
      });
    }
    return sub === "create" ? createRecipe(db, doc) : updateRecipe(db, id, doc);
  });
  return { ok: true, operation: `recipe.${sub}`, changed: true, item };
}
