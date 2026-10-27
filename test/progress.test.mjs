import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kcal-progress-"));
process.env.KCAL_DB_FILE = path.join(tmp, "kcal.sqlite3");

const { closeDatabase, openDatabase } = await import("../src/db.mjs");
const { createFood } = await import("../src/catalog.mjs");
const { addDiaryEntry, readDay, setGoals } = await import("../src/local-diary.mjs");
const { renderProgress } = await import("../src/progress.mjs");

const FOOD = {
  schema_version: 1, kind: "food", name: "Milk", aliases: [], brand: null,
  barcodes: [], state: "as_sold", basis: { amount: 100, unit: "ml" },
  nutrients: { energy_kcal: 50, protein_g: 3, fat_g: 2, carb_g: 5, fiber_g: 0 },
  other_nutrients: {}, portions: [], category: "dairy", tags: [],
};

beforeEach(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${process.env.KCAL_DB_FILE}${suffix}`, { force: true });
});

function day(builder = {}) {
  const { totals = {}, goals = {}, incomplete = [] } = builder;
  return { totals, goals, incomplete_nutrients: incomplete };
}

test("renders all four nutrients with bars and percentages in English", () => {
  const output = renderProgress(day({
    totals: { energy_kcal: 500, protein_g: 40, fat_g: 20, fiber_g: 10 },
    goals: { energy_kcal: 2000, protein_g: 100, fat_g: 80, fiber_g: 25 },
  }), "en");
  const lines = output.split("\n");
  assert.equal(lines.length, 4);
  assert.match(lines[0], /Calories\s+[█░]{10}\s+500 \/ 2000 · 25%/);
  assert.match(lines[1], /Protein\s+[█░]{10}\s+40 \/ 100 g · 40%/);
  assert.match(lines[2], /Fat\s+[█░]{10}\s+20 \/ 80 g · 25%/);
  assert.match(lines[3], /Fiber\s+[█░]{10}\s+10 \/ 25 g · 40%/);
});

test("shows every nutrient even when a goal is missing", () => {
  const output = renderProgress(day({
    totals: { energy_kcal: 500, protein_g: 40, fat_g: 20 },
    goals: { energy_kcal: 2000, protein_g: 100 },
  }), "en");
  assert.match(output, /Fat\s+20 g · goal not set/);
  assert.match(output, /Fiber\s+0 g · goal not set/);
  const fatLine = output.split("\n").find((l) => l.includes("Fat"));
  assert.doesNotMatch(fatLine, /[█░]|%/);
});

test("marks incomplete totals as lower bounds without rounding upward", () => {
  const output = renderProgress(day({
    totals: { fiber_g: 7.46 },
    goals: { fiber_g: 30 },
    incomplete: ["fiber_g"],
  }), "en");
  assert.match(output, /≥7\.4 \/ 30 g/);
  assert.match(output, /≥24%/);
});

test("preserves fractional targets exactly", () => {
  const output = renderProgress(day({
    totals: { fat_g: 31.25 },
    goals: { fat_g: 62.5 },
  }), "en");
  assert.match(output, /31\.3 \/ 62\.5 g · 50%/);
});

test("Russian output uses decimal comma and Russian labels", () => {
  const output = renderProgress(day({
    totals: { protein_g: 36.2 },
    goals: { protein_g: 160 },
  }), "ru");
  assert.match(output, /Белок\s+[█░]{10}\s+36,2 \/ 160 г/);
});

test("kcal progress reads real diary data end to end", async () => {
  const db = openDatabase();
  const food = createFood(db, FOOD);
  await addDiaryEntry(db, food.id, { amount: 200, unit: "ml", meal: "breakfast", date: "2026-09-24" });
  setGoals(db, { energy: 2000, protein: 100, fat: 80, fiber: 25 });
  const output = renderProgress(readDay(db, "2026-09-24"), "en");
  assert.match(output, /100 \/ 2000/);
  assert.match(output, /6 \/ 100 g/);
  assert.match(output, /4 \/ 80 g/);
});