import { openDatabase } from "../db.mjs";
import { UsageError } from "../errors.mjs";
import { getGoals, setGoals } from "../local-diary.mjs";

export const knownFlags = new Set(["energy", "protein", "fat", "carb", "fiber"]);

export async function run(positionals, flags) {
  const sub = positionals[0];
  const db = openDatabase({ create: sub !== "show" });
  if (sub === "show") return { ok: true, operation: "goal.show", goals: getGoals(db) };
  if (sub === "set") return { ok: true, operation: "goal.set", changed: true, goals: setGoals(db, flags) };
  throw new UsageError("usage: kcal goal <set|show> [--energy ... --protein ... --fat ... --carb ... --fiber ...]");
}
