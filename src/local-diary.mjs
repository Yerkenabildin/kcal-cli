import { getItem, getItemProfile } from "./catalog.mjs";
import { withTransaction } from "./db.mjs";
import { UsageError } from "./errors.mjs";
import { createId, parseId } from "./ids.mjs";
import {
  addNutrients, assertCompatibleUnit, canonicalFiber, emptyNutrients, FIBER_ALIASES, normalizeUnit, scaleProfile,
} from "./nutrition.mjs";
import { DAYTIMES, requireDaytime } from "./params.mjs";
import { entryTimestamp, roundDeep, toDateString, toTimestamp } from "./util.mjs";
import { materializeResolvedItem, resolveInputCandidate } from "./services/catalog-service.mjs";

function now() { return new Date().toISOString(); }
function parse(value, fallback = {}) { try { return JSON.parse(value); } catch { return fallback; } }

function rowEntry(row) {
  return {
    id: row.id,
    item_id: row.item_id,
    item_version: row.item_version,
    name: row.name_snapshot,
    amount: row.amount,
    unit: row.unit,
    meal: row.meal,
    logged_at: row.logged_at,
    date: row.entry_date,
    nutrients: parse(row.nutrients_json),
    deleted_at: row.deleted_at,
  };
}

function totalsOf(entries) {
  const total = emptyNutrients();
  const incompleteNutrients = new Set();
  for (const entry of entries) {
    const nutrients = { ...entry.nutrients };
    const fiber = canonicalFiber(nutrients);
    if (fiber === null) incompleteNutrients.add("fiber_g");
    else nutrients.fiber_g = fiber;
    for (const key of FIBER_ALIASES) delete nutrients[key];
    addNutrients(total, nutrients);
  }
  return {
    totals: roundDeep(total),
    incomplete_nutrients: [...incompleteNutrients],
  };
}

export function getGoals(db) {
  if (!db) return null;
  const row = db.prepare("SELECT * FROM goals WHERE id=1").get();
  if (!row) return null;
  return {
    energy_kcal: row.energy_kcal,
    protein_g: row.protein_g,
    fat_g: row.fat_g,
    carb_g: row.carb_g,
    fiber_g: row.fiber_g,
    updated_at: row.updated_at,
  };
}

export function setGoals(db, values) {
  const current = getGoals(db) || {};
  const next = {};
  for (const [flag, key] of [["energy", "energy_kcal"], ["protein", "protein_g"], ["fat", "fat_g"], ["carb", "carb_g"], ["fiber", "fiber_g"]]) {
    const raw = values[flag];
    if (raw === undefined) next[key] = current[key] ?? null;
    else {
      const number = Number(raw);
      if (!Number.isFinite(number) || number < 0) throw new UsageError(`--${flag} must be a non-negative number`);
      next[key] = number;
    }
  }
  if (Object.values(next).every((value) => value === null)) throw new UsageError("give at least one goal value");
  const stamp = now();
  db.prepare(`INSERT INTO goals(id, energy_kcal, protein_g, fat_g, carb_g, fiber_g, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET energy_kcal=excluded.energy_kcal, protein_g=excluded.protein_g,
      fat_g=excluded.fat_g, carb_g=excluded.carb_g, fiber_g=excluded.fiber_g, updated_at=excluded.updated_at`)
    .run(next.energy_kcal, next.protein_g, next.fat_g, next.carb_g, next.fiber_g, stamp);
  return getGoals(db);
}

function remaining(goals, totals, incompleteNutrients = []) {
  if (!goals) return null;
  const incomplete = new Set(incompleteNutrients);
  const result = {};
  for (const key of ["energy_kcal", "protein_g", "fat_g", "carb_g", "fiber_g"]) {
    result[key] = goals[key] === null || incomplete.has(key) ? null : goals[key] - totals[key];
  }
  return roundDeep(result);
}

export function readDay(db, dateValue) {
  const date = toDateString(dateValue);
  const rows = db ? db.prepare(`SELECT * FROM diary_entries
    WHERE entry_date=? AND deleted_at IS NULL ORDER BY logged_at, id`).all(date) : [];
  const meals = Object.fromEntries(DAYTIMES.map((meal) => [meal, []]));
  const entries = rows.map(rowEntry);
  for (const entry of entries) meals[entry.meal].push(entry);
  const summary = totalsOf(entries);
  const goals = getGoals(db);
  return {
    ok: true,
    operation: "diary.day",
    date,
    meals,
    entry_count: entries.length,
    totals: summary.totals,
    incomplete_nutrients: summary.incomplete_nutrients,
    goals,
    remaining: remaining(goals, summary.totals, summary.incomplete_nutrients),
  };
}

export async function addDiaryEntry(db, target, options) {
  const amount = Number(options.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new UsageError("--amount must be greater than zero");
  const unit = normalizeUnit(options.unit, "--unit");
  const meal = requireDaytime(options.meal);
  const date = toDateString(options.date);
  const loggedAt = options.at === undefined ? entryTimestamp(date) : toTimestamp(options.at, "--at");
  if (loggedAt.slice(0, 10) !== date) throw new UsageError("--at must fall on --date");
  const opKey = options.opKey || null;
  if (opKey) {
    const previous = db.prepare("SELECT result_json FROM operations WHERE op_key=?").get(opKey);
    if (previous) return { ...parse(previous.result_json), changed: false, already_logged: true };
  }
  const candidate = await resolveInputCandidate(db, target);
  const item = candidate;
  if (item.status === "needs_review") throw new UsageError("item needs review before it can be logged", { item_id: item.id });
  if (item.status === "archived") throw new UsageError("archived item cannot be logged", { item_id: item.id });
  const profile = getItem(db, item.id)
    ? getItemProfile(db, item.id)
    : { basis: item.basis, nutrients: item.nutrients, other_nutrients: item.other_nutrients || {} };
  assertCompatibleUnit(profile.basis.unit, unit);
  const nutrients = scaleProfile(profile, amount, unit);
  const id = createId("e");
  const stamp = now();
  let result;
  withTransaction(db, () => {
    const storedItem = materializeResolvedItem(db, candidate);
    db.prepare(`INSERT INTO diary_entries(
      id, item_id, item_version, name_snapshot, amount, unit, meal, logged_at, entry_date,
      nutrients_json, op_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, storedItem.id, storedItem.version, storedItem.name, amount, unit, meal, loggedAt, date,
      JSON.stringify(nutrients), opKey, stamp, stamp,
    );
    const entry = rowEntry(db.prepare("SELECT * FROM diary_entries WHERE id=?").get(id));
    db.prepare("INSERT INTO diary_entry_revisions(entry_id, action, snapshot_json, changed_at) VALUES (?, 'create', ?, ?)")
      .run(id, JSON.stringify(entry), stamp);
    result = {
      ok: true,
      operation: "diary.add",
      changed: true,
      entry,
      day: readDay(db, date),
      ...(opKey ? { operation_key: opKey } : {}),
    };
    if (opKey) db.prepare("INSERT INTO operations(op_key, operation, result_json, created_at) VALUES (?, 'diary.add', ?, ?)")
      .run(opKey, JSON.stringify(result), stamp);
  });
  return roundDeep(result);
}

function requireEntry(db, id) {
  if (!parseId(id, { allowEntry: true }) || !String(id).startsWith("e::")) throw new UsageError("entry id must look like e::<uuid>");
  const row = db.prepare("SELECT * FROM diary_entries WHERE id=?").get(id);
  if (!row) throw new UsageError(`no diary entry found with id ${id}`);
  return row;
}

export function updateDiaryEntry(db, id, changes) {
  const row = requireEntry(db, id);
  if (row.deleted_at) throw new UsageError("a removed diary entry cannot be updated", { entry_id: id });
  const before = rowEntry(row);
  const amount = changes.amount === undefined ? row.amount : Number(changes.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new UsageError("--amount must be greater than zero");
  const unit = changes.unit === undefined ? row.unit : normalizeUnit(changes.unit, "--unit");
  assertCompatibleUnit(row.unit, unit);
  const meal = changes.meal === undefined ? row.meal : requireDaytime(changes.meal);
  const loggedAt = changes.at === undefined ? row.logged_at : toTimestamp(changes.at, "--at");
  const date = loggedAt.slice(0, 10);
  const oldNutrients = parse(row.nutrients_json);
  const factor = amount / row.amount;
  const nutrients = Object.fromEntries(Object.entries(oldNutrients).map(([key, value]) =>
    [key, typeof value === "number" ? value * factor : value]));
  const stamp = now();
  withTransaction(db, () => {
    db.prepare("INSERT INTO diary_entry_revisions(entry_id, action, snapshot_json, changed_at) VALUES (?, 'update', ?, ?)")
      .run(id, JSON.stringify(before), stamp);
    db.prepare(`UPDATE diary_entries SET amount=?, unit=?, meal=?, logged_at=?, entry_date=?,
      nutrients_json=?, updated_at=? WHERE id=?`).run(
      amount, unit, meal, loggedAt, date, JSON.stringify(roundDeep(nutrients)), stamp, id,
    );
  });
  return {
    ok: true,
    operation: "diary.update",
    changed: JSON.stringify(before) !== JSON.stringify(rowEntry(db.prepare("SELECT * FROM diary_entries WHERE id=?").get(id))),
    entry: rowEntry(db.prepare("SELECT * FROM diary_entries WHERE id=?").get(id)),
    day: readDay(db, date),
  };
}

export function removeDiaryEntry(db, id) {
  const row = requireEntry(db, id);
  if (row.deleted_at) {
    return { ok: true, operation: "diary.remove", changed: false, already_absent: true, entry_id: id };
  }
  const before = rowEntry(row);
  const stamp = now();
  withTransaction(db, () => {
    db.prepare("INSERT INTO diary_entry_revisions(entry_id, action, snapshot_json, changed_at) VALUES (?, 'remove', ?, ?)")
      .run(id, JSON.stringify(before), stamp);
    db.prepare("UPDATE diary_entries SET deleted_at=?, updated_at=? WHERE id=?").run(stamp, stamp, id);
  });
  return {
    ok: true,
    operation: "diary.remove",
    changed: true,
    removed: before,
    day: readDay(db, row.entry_date),
  };
}

function datesBetween(start, end) {
  const dates = [];
  for (let cursor = new Date(`${start}T00:00:00Z`); cursor <= new Date(`${end}T00:00:00Z`); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

export function diaryTotals(db, startValue, endValue) {
  const end = toDateString(endValue);
  const start = toDateString(startValue ?? end);
  if (start > end) throw new UsageError(`--start (${start}) is after --end (${end})`);
  const rows = db ? db.prepare(`SELECT * FROM diary_entries WHERE entry_date BETWEEN ? AND ?
    AND deleted_at IS NULL ORDER BY entry_date`).all(start, end).map(rowEntry) : [];
  const byDate = new Map();
  for (const entry of rows) {
    if (!byDate.has(entry.date)) byDate.set(entry.date, []);
    byDate.get(entry.date).push(entry);
  }
  const days = datesBetween(start, end).map((date) => {
    const summary = totalsOf(byDate.get(date) || []);
    return {
      date,
      logged: byDate.has(date),
      ...summary.totals,
      incomplete_nutrients: summary.incomplete_nutrients,
    };
  });
  const logged = days.filter((day) => day.logged);
  const incompleteNutrients = [...new Set(logged.flatMap((day) => day.incomplete_nutrients))];
  const averages = {};
  for (const key of ["energy_kcal", "protein_g", "fat_g", "carb_g", "fiber_g"]) {
    const known = logged.map((day) => day[key]).filter((value) => value !== null);
    averages[key] = known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : 0;
  }
  return roundDeep({
    ok: true,
    operation: "diary.totals",
    start,
    end,
    days,
    incomplete_nutrients: incompleteNutrients,
    averages: { days_counted: logged.length, days_in_range: days.length, ...averages },
  });
}
