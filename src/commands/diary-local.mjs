import { openDatabase } from "../db.mjs";
import { UsageError } from "../errors.mjs";
import { addDiaryEntry, diaryTotals, readDay, removeDiaryEntry, updateDiaryEntry } from "../local-diary.mjs";
import { toStringFlag } from "../util.mjs";
import { requireYes } from "./_shared.mjs";

export const knownFlags = new Set(["amount", "unit", "meal", "date", "at", "op-key", "start", "end", "yes"]);

export async function run(positionals, flags) {
  const sub = positionals[0] || "day";
  const db = openDatabase({ create: !["day", "totals"].includes(sub) });
  if (sub === "day") return readDay(db, positionals[1] ?? toStringFlag(flags.date, "--date"));
  if (sub === "totals") return diaryTotals(db, toStringFlag(flags.start, "--start"), toStringFlag(flags.end, "--end"));
  if (sub === "add") {
    const target = positionals.slice(1).join(" ").trim();
    if (!target) throw new UsageError("usage: kcal diary add <item-id|exact-name> --amount N --unit g --meal lunch");
    return addDiaryEntry(db, target, {
      amount: flags.amount,
      unit: flags.unit,
      meal: flags.meal,
      date: toStringFlag(flags.date, "--date"),
      at: toStringFlag(flags.at, "--at"),
      opKey: toStringFlag(flags["op-key"], "--op-key"),
    });
  }
  const id = positionals[1];
  if (sub === "update") {
    if (!id) throw new UsageError("usage: kcal diary update <entry-id> [--amount N] [--meal slot] [--at timestamp]");
    return updateDiaryEntry(db, id, {
      amount: flags.amount,
      unit: flags.unit,
      meal: flags.meal,
      at: toStringFlag(flags.at, "--at"),
    });
  }
  if (sub === "remove") {
    if (!id) throw new UsageError("usage: kcal diary remove <entry-id> --yes");
    requireYes(flags, `kcal diary remove ${id} --yes`);
    return removeDiaryEntry(db, id);
  }
  throw new UsageError(`unknown diary subcommand: ${sub}`);
}
