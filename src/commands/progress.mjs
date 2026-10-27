import { openDatabase } from "../db.mjs";
import { readDay } from "../local-diary.mjs";
import { renderProgress } from "../progress.mjs";

export const knownFlags = new Set(["lang", "date", "json"]);

export async function run(positionals, flags) {
  const date = positionals[0] ?? flags.date;
  const db = openDatabase({ create: false });
  const day = readDay(db, date);
  const language = flags.lang === "ru" ? "ru" : "en";

  if (flags.json !== undefined) {
    return {
      ok: true,
      operation: "progress",
      date: day.date,
      totals: day.totals,
      goals: day.goals,
      incomplete_nutrients: day.incomplete_nutrients,
      text: renderProgress(day, language),
    };
  }

  process.stdout.write(`${renderProgress(day, language)}\n`);
  return undefined;
}