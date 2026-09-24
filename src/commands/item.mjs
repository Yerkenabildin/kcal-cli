import { archiveItem, getItem, getItemProfile, setVerified, toProductDocument, updateFood } from "../catalog.mjs";
import { openDatabase, withTransaction } from "../db.mjs";
import { UsageError } from "../errors.mjs";
import { scaleProfile } from "../nutrition.mjs";
import { labelToProduct } from "../providers/openrouter.mjs";
import { roundDeep, toNumber, toStringFlag } from "../util.mjs";
import { materializeItem, materializeResolvedItem, resolveItem } from "../services/catalog-service.mjs";
import { requireYes } from "./_shared.mjs";
import { assignPath, setValues } from "./_io.mjs";

export const knownFlags = new Set(["amount", "unit", "set", "yes"]);

export async function run(positionals, flags) {
  const sub = positionals[0];
  const id = positionals[1];
  if (!sub || !["show", "save", "update", "verify", "archive"].includes(sub)) {
    throw new UsageError("usage: kcal item <show|save|update|verify|archive> <item-id>");
  }
  if (!id) throw new UsageError(`usage: kcal item ${sub} <item-id>`);
  const db = openDatabase({ create: sub !== "show" });
  if (sub === "show") {
    const item = await resolveItem(db, id);
    if (!item) throw new UsageError(`no item found with id ${id}`);
    const result = { ok: true, operation: "item.show", item };
    if (flags.amount !== undefined) {
      const amount = toNumber(flags.amount, "--amount", { exclusiveMin: 0 });
      const unit = toStringFlag(flags.unit, "--unit") || item.basis?.unit;
      if (!unit || !item.basis) throw new UsageError("item has no usable nutrient basis");
      const profile = item.provenance?.source && !item.created_at
        ? { basis: item.basis, nutrients: item.nutrients, other_nutrients: item.other_nutrients }
        : getItemProfile(db, item.id);
      result.for_amount = { amount, unit, nutrients: scaleProfile(profile, amount, unit) };
    }
    return roundDeep(result);
  }
  if (sub === "save") {
    const existed = Boolean(getItem(db, id));
    return { ok: true, operation: "item.save", changed: !existed, item: await materializeItem(db, id) };
  }
  if (sub === "update") return update(db, id, flags);
  if (sub === "verify") {
    const candidate = await resolveItem(db, id);
    if (!candidate) throw new UsageError(`no item found with id ${id}`);
    return withTransaction(db, () => {
      materializeResolvedItem(db, candidate);
      return { ok: true, operation: "item.verify", changed: true, item: setVerified(db, id) };
    });
  }
  requireYes(flags, `kcal item archive ${id} --yes`);
  const candidate = await resolveItem(db, id);
  if (!candidate) throw new UsageError(`no item found with id ${id}`);
  return withTransaction(db, () => {
    materializeResolvedItem(db, candidate);
    return { ok: true, operation: "item.archive", changed: true, item: archiveItem(db, id) };
  });
}

async function update(db, id, flags) {
  const sets = setValues(flags.set);
  let local = await resolveItem(db, id);
  if (!local) throw new UsageError(`no item found with id ${id}`);
  if (local.status === "needs_review" && id.startsWith("scan::") && !local.created_at) {
    const row = db.prepare("SELECT result_json FROM scan_results WHERE id=?").get(id);
    const stored = JSON.parse(row.result_json);
    for (const [key, value] of sets) assignPath(stored.raw, key, value);
    const converted = labelToProduct(stored.raw);
    const status = converted.needsReview ? "needs_review" : "active";
    db.prepare("UPDATE scan_results SET status=?, result_json=?, warnings_json=? WHERE id=?").run(
      status, JSON.stringify({ raw: stored.raw, document: converted.document }),
      JSON.stringify(stored.raw.warnings || []), id,
    );
    local = await resolveItem(db, id);
    return { ok: true, operation: "item.update", changed: true, item: local };
  }
  local = await materializeItem(db, id);
  if (local.kind !== "food") throw new UsageError("use recipe update for recipes");
  const doc = toProductDocument(local);
  for (const [key, value] of sets) assignPath(doc, key, value);
  return { ok: true, operation: "item.update", changed: true, item: updateFood(db, id, doc) };
}
