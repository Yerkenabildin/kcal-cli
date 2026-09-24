import { createFood } from "../catalog.mjs";
import { openDatabase } from "../db.mjs";
import { UsageError } from "../errors.mjs";
import { toStringFlag } from "../util.mjs";
import { readJsonInput } from "./_io.mjs";

export const knownFlags = new Set(["file"]);

export async function run(positionals, flags) {
  const sub = positionals[0];
  if (sub !== "create") throw new UsageError("usage: kcal food create --file product.json");
  const doc = await readJsonInput(toStringFlag(flags.file, "--file"), "--file");
  const item = createFood(openDatabase(), doc);
  return { ok: true, operation: "food.create", changed: true, item };
}
