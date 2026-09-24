import { AmbiguousMatchError, UsageError } from "./errors.mjs";
import { createId, normalizeBarcode, parseId } from "./ids.mjs";
import {
  addNutrients, assertCompatibleUnit, canonicalFiber, emptyNutrients, FIBER_ALIASES, normalizeUnit, scaleProfile,
} from "./nutrition.mjs";
import { refreshItemFts, withTransaction } from "./db.mjs";
import { validateProduct, validateRecipe } from "./schemas.mjs";
import { roundDeep } from "./util.mjs";

export function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function json(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function now() { return new Date().toISOString(); }

function insertAliases(db, itemId, aliases = []) {
  const statement = db.prepare("INSERT OR IGNORE INTO item_aliases(item_id, alias, normalized_alias) VALUES (?, ?, ?)");
  for (const alias of aliases) {
    const clean = String(alias || "").trim();
    const normalized = normalizeText(clean);
    if (clean && normalized) statement.run(itemId, clean, normalized);
  }
}

function insertBarcodes(db, itemId, barcodes = []) {
  const statement = db.prepare("INSERT OR IGNORE INTO barcodes(item_id, barcode) VALUES (?, ?)");
  for (const raw of barcodes) {
    const barcode = normalizeBarcode(raw);
    if (barcode) statement.run(itemId, barcode);
  }
}

function insertPortions(db, itemId, portions = []) {
  const statement = db.prepare("INSERT INTO portions(item_id, name, amount, unit) VALUES (?, ?, ?, ?)");
  for (const portion of portions) {
    statement.run(itemId, String(portion.name).trim(), portion.amount, normalizeUnit(portion.unit));
  }
}

function idProvenance(id, fallback = "manual") {
  const prefix = parseId(id)?.prefix;
  if (prefix === "y") return { provenance: "yazio", source: "yazio", externalId: parseId(id).externalId };
  if (prefix === "off") return { provenance: "open_food_facts", source: "open_food_facts", externalId: parseId(id).externalId };
  if (prefix === "scan") return { provenance: "label", source: "scan", externalId: parseId(id).externalId };
  return { provenance: fallback, source: null, externalId: null };
}

export function createFood(db, input, options = {}) {
  const doc = structuredClone(input);
  validateProduct(doc);
  const id = options.id || createId("l");
  const existing = db.prepare("SELECT id FROM items WHERE id = ?").get(id);
  if (existing) return getItem(db, id);
  const stamp = now();
  const origin = idProvenance(id, options.provenanceType || "manual");
  const status = options.status || "active";
  const verification = options.verification || "unverified";

  withTransaction(db, () => {
    db.prepare(`INSERT INTO items(
      id, kind, name, normalized_name, brand, state, status, verification,
      category, tags_json, provenance_type, external_source, external_id,
      version, created_at, updated_at
    ) VALUES (?, 'food', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(
      id, doc.name.trim(), normalizeText(doc.name), doc.brand ?? null, doc.state || "unknown",
      status, verification, doc.category ?? null, JSON.stringify(doc.tags || []),
      options.provenanceType || origin.provenance, options.externalSource ?? origin.source,
      options.externalId ?? origin.externalId, stamp, stamp,
    );
    db.prepare(`INSERT INTO nutrients(
      item_id, basis_amount, basis_unit, energy_kcal, protein_g, fat_g, carb_g, fiber_g, other_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, doc.basis.amount, normalizeUnit(doc.basis.unit), doc.nutrients.energy_kcal,
      doc.nutrients.protein_g, doc.nutrients.fat_g, doc.nutrients.carb_g,
      doc.nutrients.fiber_g ?? null, JSON.stringify(doc.other_nutrients || {}),
    );
    insertAliases(db, id, doc.aliases);
    insertBarcodes(db, id, doc.barcodes);
    insertPortions(db, id, doc.portions);
    refreshItemFts(db, id);
  });
  return getItem(db, id);
}

export function updateFood(db, id, input, { status, verification } = {}) {
  const doc = structuredClone(input);
  validateProduct(doc);
  const row = db.prepare("SELECT kind FROM items WHERE id = ?").get(id);
  if (!row) throw new UsageError(`no item found with id ${id}`);
  if (row.kind !== "food") throw new UsageError(`${id} is a recipe; use recipe update`);
  const stamp = now();
  withTransaction(db, () => {
    db.prepare(`UPDATE items SET name=?, normalized_name=?, brand=?, state=?, category=?, tags_json=?,
      status=COALESCE(?, status), verification=COALESCE(?, verification), version=version+1, updated_at=? WHERE id=?`).run(
      doc.name.trim(), normalizeText(doc.name), doc.brand ?? null, doc.state || "unknown",
      doc.category ?? null, JSON.stringify(doc.tags || []), status ?? null, verification ?? null, stamp, id,
    );
    db.prepare(`UPDATE nutrients SET basis_amount=?, basis_unit=?, energy_kcal=?, protein_g=?, fat_g=?,
      carb_g=?, fiber_g=?, other_json=? WHERE item_id=?`).run(
      doc.basis.amount, normalizeUnit(doc.basis.unit), doc.nutrients.energy_kcal, doc.nutrients.protein_g,
      doc.nutrients.fat_g, doc.nutrients.carb_g, doc.nutrients.fiber_g ?? null,
      JSON.stringify(doc.other_nutrients || {}), id,
    );
    db.prepare("DELETE FROM item_aliases WHERE item_id=?").run(id);
    db.prepare("DELETE FROM barcodes WHERE item_id=?").run(id);
    db.prepare("DELETE FROM portions WHERE item_id=?").run(id);
    insertAliases(db, id, doc.aliases);
    insertBarcodes(db, id, doc.barcodes);
    insertPortions(db, id, doc.portions);
    refreshItemFts(db, id);
  });
  return getItem(db, id);
}

export function createRecipe(db, input, options = {}) {
  const doc = structuredClone(input);
  validateRecipe(doc);
  const id = options.id || createId("r");
  if (db.prepare("SELECT id FROM items WHERE id=?").get(id)) throw new UsageError(`item already exists: ${id}`);
  validateIngredients(db, id, doc);
  const stamp = now();
  withTransaction(db, () => {
    db.prepare(`INSERT INTO items(
      id, kind, name, normalized_name, state, status, verification, tags_json,
      provenance_type, version, created_at, updated_at
    ) VALUES (?, 'recipe', ?, ?, 'prepared', 'active', ?, ?, 'manual', 1, ?, ?)`).run(
      id, doc.name.trim(), normalizeText(doc.name), options.verification || "unverified",
      JSON.stringify(doc.tags || []), stamp, stamp,
    );
    db.prepare("INSERT INTO recipes(item_id, yield_amount, yield_unit) VALUES (?, ?, ?)")
      .run(id, doc.yield.amount, normalizeUnit(doc.yield.unit));
    const ingredient = db.prepare(`INSERT INTO recipe_ingredients(
      recipe_id, position, ingredient_id, amount, unit
    ) VALUES (?, ?, ?, ?, ?)`);
    doc.ingredients.forEach((entry, index) => ingredient.run(id, index, entry.item_id, entry.amount, normalizeUnit(entry.unit)));
    insertAliases(db, id, doc.aliases);
    insertPortions(db, id, doc.portions);
    refreshItemFts(db, id);
    assertNoRecipeCycle(db, id);
  });
  return getItem(db, id);
}

export function updateRecipe(db, id, input) {
  const doc = structuredClone(input);
  validateRecipe(doc);
  const row = db.prepare("SELECT kind FROM items WHERE id=?").get(id);
  if (!row) throw new UsageError(`no item found with id ${id}`);
  if (row.kind !== "recipe") throw new UsageError(`${id} is not a recipe`);
  validateIngredients(db, id, doc);
  withTransaction(db, () => {
    db.prepare(`UPDATE items SET name=?, normalized_name=?, tags_json=?, version=version+1, updated_at=? WHERE id=?`)
      .run(doc.name.trim(), normalizeText(doc.name), JSON.stringify(doc.tags || []), now(), id);
    db.prepare("UPDATE recipes SET yield_amount=?, yield_unit=? WHERE item_id=?")
      .run(doc.yield.amount, normalizeUnit(doc.yield.unit), id);
    db.prepare("DELETE FROM recipe_ingredients WHERE recipe_id=?").run(id);
    db.prepare("DELETE FROM item_aliases WHERE item_id=?").run(id);
    db.prepare("DELETE FROM portions WHERE item_id=?").run(id);
    const ingredient = db.prepare("INSERT INTO recipe_ingredients(recipe_id, position, ingredient_id, amount, unit) VALUES (?, ?, ?, ?, ?)");
    doc.ingredients.forEach((entry, index) => ingredient.run(id, index, entry.item_id, entry.amount, normalizeUnit(entry.unit)));
    insertAliases(db, id, doc.aliases);
    insertPortions(db, id, doc.portions);
    refreshItemFts(db, id);
    assertNoRecipeCycle(db, id);
  });
  return getItem(db, id);
}

function validateIngredients(db, recipeId, doc) {
  for (const entry of doc.ingredients) {
    if (entry.item_id === recipeId) throw new UsageError("a recipe cannot contain itself");
    const item = getItem(db, entry.item_id);
    if (!item) throw new UsageError(`ingredient does not exist: ${entry.item_id}`);
    if (item.status === "archived") throw new UsageError(`ingredient is archived: ${entry.item_id}`);
    assertCompatibleUnit(item.basis.unit, entry.unit);
  }
  for (const portion of doc.portions || []) assertCompatibleUnit(doc.yield.unit, portion.unit);
}

export function assertNoRecipeCycle(db, rootId) {
  const visiting = new Set();
  const visited = new Set();
  function walk(id, path = []) {
    if (visiting.has(id)) throw new UsageError("recipe cycle detected", { cycle: [...path, id] });
    if (visited.has(id)) return;
    visiting.add(id);
    const children = db.prepare(`SELECT ri.ingredient_id FROM recipe_ingredients ri
      JOIN items i ON i.id=ri.ingredient_id WHERE ri.recipe_id=? AND i.kind='recipe'`).all(id);
    for (const child of children) walk(child.ingredient_id, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  }
  walk(rootId);
}

function foodProfile(db, itemId) {
  const row = db.prepare("SELECT * FROM nutrients WHERE item_id=?").get(itemId);
  if (!row) return null;
  const otherNutrients = json(row.other_json, {});
  const fiber = canonicalFiber({ ...otherNutrients, fiber_g: row.fiber_g });
  if (fiber !== null) {
    for (const key of FIBER_ALIASES) delete otherNutrients[key];
  }
  return {
    basis: { amount: row.basis_amount, unit: row.basis_unit },
    nutrients: {
      energy_kcal: row.energy_kcal,
      protein_g: row.protein_g,
      fat_g: row.fat_g,
      carb_g: row.carb_g,
      fiber_g: fiber,
    },
    other_nutrients: otherNutrients,
  };
}

export function getItemProfile(db, itemId, stack = []) {
  if (stack.includes(itemId)) throw new UsageError("recipe cycle detected while calculating nutrients", { cycle: [...stack, itemId] });
  const item = db.prepare("SELECT kind FROM items WHERE id=?").get(itemId);
  if (!item) return null;
  if (item.kind === "food") return foodProfile(db, itemId);
  const recipe = db.prepare("SELECT * FROM recipes WHERE item_id=?").get(itemId);
  if (!recipe) return null;
  const ingredients = db.prepare("SELECT * FROM recipe_ingredients WHERE recipe_id=? ORDER BY position").all(itemId);
  const total = emptyNutrients();
  const other = {};
  let fiberKnown = true;
  for (const ingredient of ingredients) {
    const profile = getItemProfile(db, ingredient.ingredient_id, [...stack, itemId]);
    if (!profile) throw new UsageError(`ingredient has no nutrients: ${ingredient.ingredient_id}`);
    const scaled = scaleProfile(profile, ingredient.amount, ingredient.unit);
    if (scaled.fiber_g === null) fiberKnown = false;
    addNutrients(total, scaled);
    for (const [key, value] of Object.entries(scaled)) {
      if (!NUTRIENT_COLUMNS.has(key) && typeof value === "number") other[key] = (other[key] || 0) + value;
    }
  }
  if (!fiberKnown) total.fiber_g = null;
  return {
    basis: { amount: recipe.yield_amount, unit: recipe.yield_unit },
    nutrients: total,
    other_nutrients: other,
  };
}

const NUTRIENT_COLUMNS = new Set(["energy_kcal", "protein_g", "fat_g", "carb_g", "fiber_g"]);

export function getItem(db, itemId) {
  if (!db) return null;
  const row = db.prepare("SELECT * FROM items WHERE id=?").get(itemId);
  if (!row) return null;
  const aliases = db.prepare("SELECT alias FROM item_aliases WHERE item_id=? ORDER BY alias").all(itemId).map((entry) => entry.alias);
  const barcodes = db.prepare("SELECT barcode FROM barcodes WHERE item_id=? ORDER BY barcode").all(itemId).map((entry) => entry.barcode);
  const portions = db.prepare("SELECT name, amount, unit FROM portions WHERE item_id=? ORDER BY id").all(itemId);
  const favorite = Boolean(db.prepare("SELECT 1 FROM favorites WHERE item_id=?").get(itemId));
  const profile = getItemProfile(db, itemId);
  const result = {
    id: row.id,
    kind: row.kind,
    name: row.name,
    aliases,
    brand: row.brand,
    barcodes,
    state: row.state,
    status: row.status,
    verification: row.verification,
    favorite,
    category: row.category,
    tags: json(row.tags_json, []),
    version: row.version,
    basis: profile?.basis ?? null,
    nutrients: profile?.nutrients ?? null,
    other_nutrients: profile?.other_nutrients ?? {},
    portions,
    provenance: {
      type: row.provenance_type,
      source: row.external_source,
      external_id: row.external_id,
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (row.kind === "recipe") {
    result.ingredients = db.prepare("SELECT ingredient_id AS item_id, amount, unit FROM recipe_ingredients WHERE recipe_id=? ORDER BY position").all(itemId);
    result.yield = profile?.basis ?? null;
  }
  if (profile && ["g", "ml"].includes(profile.basis.unit)) {
    result.per_100 = scaleProfile(profile, 100, profile.basis.unit);
  }
  return roundDeep(result);
}

export function toProductDocument(item) {
  if (!item || item.kind !== "food") throw new UsageError("item is not a food");
  return {
    schema_version: 1,
    kind: "food",
    name: item.name,
    aliases: item.aliases || [],
    brand: item.brand ?? null,
    barcodes: item.barcodes || [],
    state: item.state || "unknown",
    basis: item.basis,
    nutrients: item.nutrients,
    other_nutrients: item.other_nutrients || {},
    portions: item.portions || [],
    category: item.category ?? null,
    tags: item.tags || [],
  };
}

export function toRecipeDocument(item) {
  if (!item || item.kind !== "recipe") throw new UsageError("item is not a recipe");
  return {
    schema_version: 1,
    kind: "recipe",
    name: item.name,
    aliases: item.aliases || [],
    ingredients: item.ingredients || [],
    yield: item.yield,
    portions: item.portions || [],
    tags: item.tags || [],
  };
}

function searchRows(db, query, limit) {
  const normalized = normalizeText(query);
  const barcode = normalizeBarcode(query);
  if (barcode) {
    return db.prepare(`SELECT i.id, 1000 AS rank, 'barcode' AS match_kind
      FROM barcodes b JOIN items i ON i.id=b.item_id
      WHERE b.barcode=? AND i.status!='archived' LIMIT ?`).all(barcode, limit);
  }
  const exact = db.prepare(`SELECT DISTINCT i.id,
      CASE WHEN i.normalized_name=? THEN 950 ELSE 925 END AS rank,
      CASE WHEN i.normalized_name=? THEN 'name' ELSE 'alias' END AS match_kind
    FROM items i LEFT JOIN item_aliases a ON a.item_id=i.id
    WHERE i.status!='archived' AND (i.normalized_name=? OR a.normalized_alias=?)
    ORDER BY rank DESC LIMIT ?`).all(normalized, normalized, normalized, normalized, limit);
  if (exact.length) return exact;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  let ids = [];
  if (tokens.length) {
    const ftsQuery = tokens.map((token) => `"${token.replace(/"/g, '""')}"*`).join(" AND ");
    try {
      ids = db.prepare(`SELECT id, 500 - bm25(items_fts) AS rank, 'fuzzy' AS match_kind
        FROM items_fts WHERE items_fts MATCH ? LIMIT ?`).all(ftsQuery, limit * 3);
    } catch { ids = []; }
  }
  if (!ids.length) {
    ids = db.prepare(`SELECT id, 400 AS rank, 'fuzzy' AS match_kind FROM items
      WHERE status!='archived' AND normalized_name LIKE ? LIMIT ?`).all(`%${normalized}%`, limit * 3);
  }
  return ids;
}

export function searchLocal(db, query, { limit = 10 } = {}) {
  if (!db) return [];
  const rows = searchRows(db, query, limit * 2);
  const usage = db.prepare(`SELECT item_id, COUNT(*) AS uses, MAX(entry_date) AS last_used
    FROM diary_entries WHERE deleted_at IS NULL GROUP BY item_id`).all();
  const byUsage = new Map(usage.map((row) => [row.item_id, row]));
  return rows.map((row) => {
    const item = getItem(db, row.id);
    const recent = byUsage.get(row.id);
    const score = row.rank + (item.favorite ? 40 : 0) + Math.min(Number(recent?.uses || 0), 20);
    return searchShape(item, { score, match: row.match_kind, recent });
  }).sort((a, b) => b.score - a.score).slice(0, limit);
}

export function searchShape(item, { score = null, match = null, recent = null } = {}) {
  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    brand: item.brand,
    status: item.status,
    verification: item.verification,
    favorite: item.favorite,
    basis: item.basis,
    nutrients: item.nutrients,
    per_100: item.per_100,
    portions: item.portions,
    barcodes: item.barcodes,
    match,
    score,
    ...(recent ? { recent: { uses: recent.uses, last_used: recent.last_used } } : {}),
  };
}

export function findUniqueExact(db, query) {
  const matches = searchLocal(db, query, { limit: 20 }).filter((result) => ["barcode", "name", "alias"].includes(result.match));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new AmbiguousMatchError(`more than one local item exactly matches "${query}"`, { candidates: matches });
  return null;
}

export function addFavorite(db, itemId, alias) {
  const item = getItem(db, itemId);
  if (!item) throw new UsageError(`no item found with id ${itemId}`);
  let changed = false;
  withTransaction(db, () => {
    const result = db.prepare("INSERT OR IGNORE INTO favorites(item_id, created_at) VALUES (?, ?)").run(itemId, now());
    changed = result.changes > 0;
    if (alias) insertAliases(db, itemId, [alias]);
    refreshItemFts(db, itemId);
  });
  return { changed, item: getItem(db, itemId) };
}

export function removeFavorite(db, itemId) {
  const result = db.prepare("DELETE FROM favorites WHERE item_id=?").run(itemId);
  return { changed: result.changes > 0, item_id: itemId };
}

export function listFavorites(db) {
  if (!db) return [];
  return db.prepare("SELECT item_id FROM favorites ORDER BY created_at DESC").all().map((row) => getItem(db, row.item_id));
}

export function setVerified(db, itemId) {
  const result = db.prepare("UPDATE items SET verification='verified', version=version+1, updated_at=? WHERE id=?").run(now(), itemId);
  if (!result.changes) throw new UsageError(`no item found with id ${itemId}`);
  return getItem(db, itemId);
}

export function archiveItem(db, itemId) {
  const result = db.prepare("UPDATE items SET status='archived', version=version+1, updated_at=? WHERE id=?").run(now(), itemId);
  if (!result.changes) throw new UsageError(`no item found with id ${itemId}`);
  refreshItemFts(db, itemId);
  return getItem(db, itemId);
}
