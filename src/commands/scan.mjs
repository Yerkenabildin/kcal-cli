import { openDatabase } from "../db.mjs";
import { UsageError } from "../errors.mjs";
import { scanImage } from "../services/scan-service.mjs";
import { toInt, toStringFlag } from "../util.mjs";

export const knownFlags = new Set(["hint", "limit"]);

export async function run(positionals, flags) {
  const filePath = positionals[0];
  if (!filePath) throw new UsageError("usage: kcal scan <image> [--hint text]");
  const limit = flags.limit === undefined ? 10 : toInt(flags.limit, "--limit", { min: 1, max: 50 });
  return scanImage(openDatabase(), filePath, { hint: toStringFlag(flags.hint, "--hint"), limit });
}
