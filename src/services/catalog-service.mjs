import { AmbiguousMatchError, UsageError } from "../errors.mjs";
import { createFood, findUniqueExact, getItem, normalizeText, searchLocal, searchShape, toProductDocument } from "../catalog.mjs";
import { normalizeBarcode, parseId } from "../ids.mjs";
import { scaleProfile } from "../nutrition.mjs";
import { getOffProduct, searchOff } from "../providers/openfoodfacts.mjs";
import { findYazioByBarcode, getYazioProduct, searchYazio } from "../providers/yazio.mjs";
import { roundDeep } from "../util.mjs";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function cacheCandidate(db, candidate) {
  if (!db || !candidate?.id) return;
  const stamp = new Date();
  db.prepare(`INSERT INTO external_cache(ref, source, external_id, payload_json, fetched_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(ref) DO UPDATE SET payload_json=excluded.payload_json, fetched_at=excluded.fetched_at,
      expires_at=excluded.expires_at`).run(
    candidate.id, candidate.source, candidate.external_id, JSON.stringify(candidate), stamp.toISOString(),
    new Date(stamp.getTime() + CACHE_TTL_MS).toISOString(),
  );
}

function cachedCandidate(db, ref, { allowExpired = false } = {}) {
  if (!db) return null;
  const row = db.prepare("SELECT payload_json, expires_at FROM external_cache WHERE ref=?").get(ref);
  if (!row || (!allowExpired && row.expires_at < new Date().toISOString())) return null;
  try { return JSON.parse(row.payload_json); } catch { return null; }
}

export function externalItem(candidate) {
  const doc = candidate.document;
  if (!doc) return null;
  const profile = { basis: doc.basis, nutrients: doc.nutrients, other_nutrients: doc.other_nutrients || {} };
  const item = {
    id: candidate.id,
    kind: "food",
    name: doc.name,
    aliases: doc.aliases || [],
    brand: doc.brand ?? null,
    barcodes: doc.barcodes || [],
    state: doc.state || "unknown",
    status: "active",
    verification: "unverified",
    favorite: false,
    category: doc.category ?? null,
    tags: doc.tags || [],
    version: 1,
    basis: doc.basis,
    nutrients: doc.nutrients,
    other_nutrients: doc.other_nutrients || {},
    portions: doc.portions || [],
    provenance: { type: candidate.source, source: candidate.source, external_id: candidate.external_id },
  };
  if (["g", "ml"].includes(doc.basis.unit)) item.per_100 = scaleProfile(profile, 100, doc.basis.unit);
  return roundDeep(item);
}

function providerError(provider, reason) {
  return { provider, error: reason?.kind || "error", message: reason?.message || String(reason) };
}

function externalSearchShape(candidate, query, index) {
  const item = externalItem(candidate);
  const barcode = normalizeBarcode(query);
  const exact = barcode
    ? item.barcodes.includes(barcode)
    : normalizeText(item.name) === normalizeText(query) || item.aliases.some((alias) => normalizeText(alias) === normalizeText(query));
  const base = barcode
    ? (candidate.source === "open_food_facts" ? 300 : 250)
    : (candidate.source === "yazio" ? 250 : 200);
  return searchShape(item, {
    match: exact ? (normalizeBarcode(query) ? "barcode" : "external_exact") : "external",
    score: base + (exact ? 50 : 0) - index,
  });
}

export async function searchCatalog(db, query, { limit = 10 } = {}) {
  const clean = String(query || "").trim();
  if (!clean) throw new UsageError("search query is required");
  const parsed = parseId(clean);
  if (parsed) {
    const item = await resolveItem(db, clean);
    return { query: clean, items: item ? [searchShape(item, { match: "id", score: 1200 })] : [], provider_errors: [] };
  }

  const local = searchLocal(db, clean, { limit });
  if (local.some((item) => ["barcode", "name", "alias"].includes(item.match))) {
    return { query: clean, items: local, provider_errors: [] };
  }

  const barcode = normalizeBarcode(clean);
  const calls = barcode
    ? [["open_food_facts", () => searchOff(barcode, { limit })], ["yazio", () => findYazioByBarcode(barcode, { limit })]]
    : [["yazio", () => searchYazio(clean, { limit })], ["open_food_facts", () => searchOff(clean, { limit })]];
  const settled = await Promise.allSettled(calls.map(([, call]) => call()));
  const providerErrors = [];
  const external = [];
  settled.forEach((result, index) => {
    const provider = calls[index][0];
    if (result.status === "rejected") { providerErrors.push(providerError(provider, result.reason)); return; }
    for (const candidate of result.value) {
      cacheCandidate(db, candidate);
      external.push(candidate);
    }
  });
  const seen = new Set(local.map((item) => item.id));
  const shaped = [];
  for (const candidate of external) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    shaped.push(externalSearchShape(candidate, clean, shaped.length));
  }
  return {
    query: clean,
    items: [...local, ...shaped].sort((a, b) => b.score - a.score).slice(0, limit),
    provider_errors: providerErrors,
  };
}

async function fetchExternal(parsed) {
  if (parsed.prefix === "y") return getYazioProduct(parsed.externalId);
  if (parsed.prefix === "off") return getOffProduct(parsed.externalId);
  return null;
}

function scanCandidate(db, id) {
  const row = db?.prepare("SELECT * FROM scan_results WHERE id=?").get(id);
  if (!row) return null;
  let stored;
  try { stored = JSON.parse(row.result_json); } catch { stored = {}; }
  if (!stored.document) {
    return {
      id,
      kind: "food",
      name: stored.raw?.name || null,
      status: "needs_review",
      verification: "unverified",
      recognition: stored.raw || null,
      warnings: JSON.parse(row.warnings_json || "[]"),
      provenance: { type: "label", source: "scan", external_id: parseId(id)?.externalId || null },
    };
  }
  return externalItem({ id, document: stored.document, source: "scan", external_id: parseId(id)?.externalId });
}

export async function resolveItem(db, ref) {
  const local = getItem(db, ref);
  if (local) return local;
  const parsed = parseId(ref);
  if (!parsed) return null;
  if (parsed.prefix === "scan") return scanCandidate(db, ref);
  let candidate = cachedCandidate(db, ref);
  if (!candidate) {
    try { candidate = await fetchExternal(parsed); }
    catch (error) {
      candidate = cachedCandidate(db, ref, { allowExpired: true });
      if (!candidate) throw error;
    }
    if (candidate) cacheCandidate(db, candidate);
  }
  return candidate ? externalItem(candidate) : null;
}

export async function materializeItem(db, ref) {
  const local = getItem(db, ref);
  if (local) return local;
  const item = await resolveItem(db, ref);
  if (!item) throw new UsageError(`no usable product found for ${ref}`);
  return materializeResolvedItem(db, item);
}

export function materializeResolvedItem(db, item) {
  const local = getItem(db, item?.id);
  if (local) return local;
  if (!item?.id || item.kind !== "food") throw new UsageError("only resolved food items can be materialized");
  if (item.status === "needs_review" || !item.basis || !item.nutrients) {
    throw new UsageError("scan result needs review before it can be used", { item_id: item.id });
  }
  return createFood(db, toProductDocument(item), {
    id: item.id,
    provenanceType: item.provenance?.type,
    externalSource: item.provenance?.source,
    externalId: item.provenance?.external_id,
  });
}

export async function resolveInputCandidate(db, value, { limit = 10 } = {}) {
  const text = String(value || "").trim();
  if (!text) throw new UsageError("an item id or exact name is required");
  if (parseId(text)) {
    const item = await resolveItem(db, text);
    if (item) return item;
    throw new UsageError(`no item found for "${text}"`);
  }
  const local = findUniqueExact(db, text);
  if (local) return getItem(db, local.id);
  const results = await searchCatalog(db, text, { limit });
  const exact = results.items.filter((item) => ["barcode", "name", "alias", "external_exact"].includes(item.match));
  const tiers = normalizeBarcode(text) ? ["off", "y"] : ["y", "off"];
  for (const prefix of tiers) {
    const tier = exact.filter((item) => parseId(item.id)?.prefix === prefix);
    if (tier.length === 1) return resolveItem(db, tier[0].id);
    if (tier.length > 1) {
      throw new AmbiguousMatchError(`could not choose one exact item for "${text}"`, {
        candidates: tier,
        hint: "repeat the command with a candidate id",
      });
    }
  }
  if (exact.length || results.items.length) {
    throw new AmbiguousMatchError(`could not choose one exact item for "${text}"`, {
      candidates: exact.length ? exact : results.items,
      hint: "repeat the command with a candidate id",
    });
  }
  throw new UsageError(`no item found for "${text}"`, { provider_errors: results.provider_errors });
}

export async function resolveInput(db, value, options = {}) {
  return materializeResolvedItem(db, await resolveInputCandidate(db, value, options));
}
