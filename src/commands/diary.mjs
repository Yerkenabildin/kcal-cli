// yazio diary day [YYYY-MM-DD]
// yazio diary totals --start YYYY-MM-DD --end YYYY-MM-DD
// yazio diary add-product <productId> --meal <daytime> (--amount N | --serving <name>)
import { UnsafeReplayError, UsageError, WriteResultUnknownError } from "../errors.mjs";
import { perAmount } from "../normalize.mjs";
import { DAYTIMES, requireDaytime } from "../params.mjs";
import { deriveEntryId, findOperation, operationKey, recordOperation } from "../state/operation-ledger.mjs";
import { entryTimestamp, roundDeep, toDateString, toNumber, toStringFlag, toTimestamp } from "../util.mjs";
import { fetchProduct } from "./product.mjs";
import { invoke } from "./_shared.mjs";

export const knownFlags = new Set([
  "start", "end", "date", "meal", "amount", "serving", "serving-quantity", "at", "op-key",
]);

const SUBCOMMANDS = ["day", "totals", "add-product"];

export async function run(positionals, flags) {
  const sub = positionals[0] || "day";
  if (sub === "day") return day(positionals[1] ?? toStringFlag(flags.date, "--date"));
  if (sub === "totals") return totals(flags);
  if (sub === "add-product") return addProduct(positionals[1], flags);
  throw new UsageError(`unknown diary subcommand: ${sub}`, { known: SUBCOMMANDS });
}

export async function readDay(date) {
  const raw = await invoke("diary.day", { query: { date } });
  return {
    products: Array.isArray(raw?.products) ? raw.products : [],
    // The third bucket is easy to forget and then a correction cannot find an entry that is
    // plainly visible in the app.
    recipe_portions: Array.isArray(raw?.recipe_portions) ? raw.recipe_portions : [],
    simple_products: Array.isArray(raw?.simple_products) ? raw.simple_products : [],
  };
}

// Diary entries reference products by id alone, so a day is a list of UUIDs until these are
// resolved. Worth the fan-out — the calls run concurrently, and a busy day holds a dozen.
async function resolveProducts(entries) {
  const ids = [...new Set(entries.map((item) => item.product_id).filter(Boolean))];
  const details = await Promise.all(ids.map(async (id) => {
    try { return await fetchProduct(id); } catch { return null; }
  }));
  return new Map(ids.map((id, index) => [id, details[index]]));
}

function shapeEntry(item, product) {
  const amount = typeof item.amount === "number" ? item.amount : null;
  const entry = {
    entry_id: item.id,
    product_id: item.product_id ?? null,
    name: product?.name ?? null,
    producer: product?.producer ?? null,
    amount,
    base_unit: product?.base_unit ?? null,
    logged_at: item.date ?? null,
  };
  // Only present when the portion was named. A raw gram amount carries no serving at all —
  // sending a null one makes YAZIO render the entry without a portion label.
  if (item.serving) entry.serving = { serving: item.serving, quantity: item.serving_quantity ?? 1 };
  if (product && amount !== null) entry.nutrients = perAmount(product.nutrients, amount);
  return entry;
}

async function day(dateFlag) {
  const date = toDateString(dateFlag);
  const [buckets, summary] = await Promise.all([
    readDay(date),
    invoke("diary.daily-summary", { query: { date } }),
  ]);

  const byId = await resolveProducts(buckets.products);
  const meals = Object.fromEntries(DAYTIMES.map((slot) => [slot, []]));
  for (const item of buckets.products) {
    const slot = DAYTIMES.includes(item.daytime) ? item.daytime : "snack";
    meals[slot].push(shapeEntry(item, byId.get(item.product_id)));
  }

  return roundDeep({
    ok: true,
    operation: "diary.day",
    date,
    meals,
    recipe_portions: buckets.recipe_portions,
    simple_products: buckets.simple_products,
    entry_count: buckets.products.length + buckets.recipe_portions.length + buckets.simple_products.length,
    totals: dayTotals(summary),
    goals: shapeGoals(summary?.goals),
  });
}

// The summary widget reports per-meal totals but no day total, so the headline "eaten today"
// number has to be assembled here rather than read off the response.
export function dayTotals(summary) {
  const sum = {};
  for (const meal of Object.values(summary?.meals ?? {})) {
    for (const [key, value] of Object.entries(meal?.nutrients ?? {})) {
      if (typeof value === "number") sum[key] = (sum[key] ?? 0) + value;
    }
  }
  return {
    energy_kcal: sum["energy.energy"] ?? 0,
    protein_g: sum["nutrient.protein"] ?? 0,
    carb_g: sum["nutrient.carb"] ?? 0,
    fat_g: sum["nutrient.fat"] ?? 0,
  };
}

export function shapeGoals(goals) {
  if (!goals) return null;
  return {
    energy_kcal: goals["energy.energy"] ?? null,
    protein_g: goals["nutrient.protein"] ?? null,
    carb_g: goals["nutrient.carb"] ?? null,
    fat_g: goals["nutrient.fat"] ?? null,
  };
}

async function totals(flags) {
  const end = toDateString(toStringFlag(flags.end, "--end"));
  const start = toDateString(toStringFlag(flags.start, "--start") ?? end);
  if (start > end) throw new UsageError(`--start (${start}) is after --end (${end})`);

  const days = await invoke("diary.nutrients-daily", { query: { start, end } });
  // The endpoint returns only days that hold something, so a missing day is an empty one
  // rather than an error — filling the gaps keeps a range readable as a range.
  const byDate = new Map((Array.isArray(days) ? days : []).map((d) => [d.date?.slice(0, 10), d]));
  const filled = [];
  for (let cursor = new Date(`${start}T00:00:00Z`); cursor <= new Date(`${end}T00:00:00Z`); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    const found = byDate.get(date);
    filled.push({
      date,
      logged: Boolean(found),
      energy_kcal: found?.energy ?? 0,
      energy_goal_kcal: found?.energy_goal ?? null,
      protein_g: found?.protein ?? 0,
      carb_g: found?.carb ?? 0,
      fat_g: found?.fat ?? 0,
    });
  }

  const logged = filled.filter((d) => d.logged);
  const mean = (key) => (logged.length ? logged.reduce((total, d) => total + d[key], 0) / logged.length : 0);

  return roundDeep({
    ok: true,
    operation: "diary.totals",
    start,
    end,
    days: filled,
    // Averaged over days that hold something: a day with nothing logged is a gap in the record,
    // not a day of eating nothing, and counting it as zero would understate every average.
    averages: {
      days_counted: logged.length,
      days_in_range: filled.length,
      energy_kcal: mean("energy_kcal"),
      protein_g: mean("protein_g"),
      carb_g: mean("carb_g"),
      fat_g: mean("fat_g"),
    },
  });
}

// Work out the base-unit amount for a portion. An explicit amount always wins; a named serving
// is looked up in the product's own table and multiplied out. If the product does not offer
// that serving we refuse rather than guess, because silently logging the wrong quantity is
// worse than being asked to name one the product has.
export function resolveAmount(product, { amount, serving, servingQuantity }) {
  if (amount !== null && amount !== undefined) return { amount, serving: null, servingQuantity: null };

  const servings = Array.isArray(product?.servings) ? product.servings : [];
  const quantity = servingQuantity ?? 1;
  const match = servings.find((option) => option?.serving === serving);
  if (!match || typeof match.amount !== "number") {
    const available = servings.map((option) => option?.serving).filter(Boolean).sort();
    throw new UsageError(
      `${product?.name ?? "this product"} does not offer a "${serving}" serving`,
      { available_servings: available, hint: "or give --amount in the product's base unit" },
    );
  }
  return { amount: match.amount * quantity, serving, servingQuantity: quantity };
}

function findEntry(buckets, entryId) {
  const wanted = String(entryId).toLowerCase();
  for (const bucket of ["products", "recipe_portions", "simple_products"]) {
    for (const item of buckets[bucket] ?? []) {
      if (String(item?.id ?? "").toLowerCase() === wanted) return { bucket, item };
    }
  }
  return null;
}

async function addProduct(productId, flags) {
  // Everything that can be checked without the network is checked before it, so a malformed
  // request never reaches a diary.
  if (!productId) {
    throw new UsageError(
      "usage: yazio diary add-product <productId> --meal <breakfast|lunch|dinner|snack> --amount <N>",
      { hint: "find a product id with `yazio search <query>`" },
    );
  }
  if (productId.includes(" ")) {
    throw new UsageError("add-product takes a product id, not a name", {
      hint: "run `yazio search <name>` first and pass the product_id it returns",
    });
  }

  const daytime = requireDaytime(flags.meal);
  const date = toDateString(toStringFlag(flags.date, "--date"));
  const at = flags.at === undefined ? entryTimestamp(date) : toTimestamp(flags.at, "--at");
  const serving = toStringFlag(flags.serving, "--serving");
  const servingQuantity = flags["serving-quantity"] === undefined
    ? null
    : toNumber(flags["serving-quantity"], "--serving-quantity", { exclusiveMin: 0 });
  const rawAmount = flags.amount === undefined
    ? null
    : toNumber(flags.amount, "--amount", { exclusiveMin: 0 });

  if (rawAmount === null && !serving) {
    throw new UsageError("give either --amount in the product's base unit, or --serving <name>");
  }

  const product = await fetchProduct(productId);
  if (!product) throw new UsageError(`no product found with id ${productId}`);
  const portion = resolveAmount(product, { amount: rawAmount, serving, servingQuantity });

  const key = toStringFlag(flags["op-key"], "--op-key")
    || operationKey({ operation: "diary.add-product", date, daytime, targetId: productId, amount: portion.amount });
  const entryId = deriveEntryId(key);

  // A repeat of the same logical write returns what the first one did. The derived id means a
  // duplicate could not be created anyway; this just avoids the round trip and reports honestly
  // that nothing changed.
  const previous = findOperation(key);
  if (previous) {
    return roundDeep({
      ...previous.result, changed: false, already_logged: true, operation_key: key,
    });
  }

  const before = await readDay(date);
  if (findEntry(before, entryId)) {
    return roundDeep(await describeWrite({ product, portion, date, daytime, at, entryId, key, changed: false }));
  }

  const entry = {
    id: entryId,
    product_id: productId,
    amount: portion.amount,
    daytime,
    date: at,
  };
  // Omitted entirely rather than sent as null when logging a raw amount: a null serving makes
  // YAZIO render the entry without a portion label.
  if (portion.serving) {
    entry.serving = portion.serving;
    entry.serving_quantity = portion.servingQuantity;
  }

  let outcomeUnknown = false;
  try {
    await invoke("diary.add", { json: { products: [entry], recipe_portions: [], simple_products: [] } });
  } catch (error) {
    if (!(error instanceof UnsafeReplayError)) throw error;
    // The write may or may not have landed. Never send it again — read the day back and let
    // the derived id say what happened.
    outcomeUnknown = true;
  }

  const after = await readDay(date);
  const found = findEntry(after, entryId);
  if (!found) {
    throw new WriteResultUnknownError(
      outcomeUnknown
        ? "the write did not complete and the entry is not in the diary; it was not sent again"
        : "YAZIO accepted the write but the entry is not in the diary",
      {
        entry_id: entryId,
        operation_key: key,
        date,
        retry_command: `yazio diary add-product ${productId} --meal ${daytime} --amount ${portion.amount} --date ${date} --op-key ${JSON.stringify(key)}`,
      },
    );
  }

  const result = await describeWrite({ product, portion, date, daytime, at, entryId, key, changed: true, logged: found.item });
  recordOperation({ operation_key: key, entry_id: entryId, date, verified: true, result });
  return roundDeep(result);
}

async function describeWrite({ product, portion, date, daytime, at, entryId, key, changed, logged }) {
  const summary = await invoke("diary.daily-summary", { query: { date } });
  return {
    ok: true,
    operation: "diary.add-product",
    changed,
    verified: true,
    operation_key: key,
    target: {
      date, daytime, product_id: product.id,
      amount: logged?.amount ?? portion.amount,
      base_unit: product.base_unit,
      logged_at: logged?.date ?? at,
      ...(portion.serving ? { serving: portion.serving, serving_quantity: portion.servingQuantity } : {}),
    },
    entry: {
      id: entryId,
      name: product.name,
      producer: product.producer ?? null,
      nutrients: perAmount(product.nutrients, logged?.amount ?? portion.amount),
    },
    day_totals: dayTotals(summary),
    goals: shapeGoals(summary?.goals),
  };
}
