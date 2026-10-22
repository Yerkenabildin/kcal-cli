import { openDatabase } from "../db.mjs";
import { UsageError } from "../errors.mjs";
import { scanImage } from "../services/scan-service.mjs";
import { toBool, toInt, toStringFlag } from "../util.mjs";

export const knownFlags = new Set(["hint", "limit", "allow-ai"]);

export async function run(positionals, flags) {
  const filePath = positionals[0];
  if (!filePath) throw new UsageError("usage: kcal scan <image> [--hint text] [--allow-ai]");
  const limit = flags.limit === undefined ? 10 : toInt(flags.limit, "--limit", { min: 1, max: 50 });
  const allowAi = flags["allow-ai"] === undefined ? false : toBool(flags["allow-ai"], "--allow-ai");
  return scanImage(openDatabase(), filePath, { hint: toStringFlag(flags.hint, "--hint"), limit, allowAi });
}
