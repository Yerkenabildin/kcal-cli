import crypto from "node:crypto";
import { UsageError } from "./errors.mjs";

const PREFIXES = new Set(["l", "r", "y", "off", "scan", "e"]);

export function createId(prefix) {
  if (!PREFIXES.has(prefix)) throw new Error(`unsupported id prefix: ${prefix}`);
  return `${prefix}::${crypto.randomUUID()}`;
}

export function parseId(value, { allowEntry = false } = {}) {
  const text = String(value || "").trim();
  const separator = text.indexOf("::");
  if (separator <= 0 || separator === text.length - 2) return null;
  const prefix = text.slice(0, separator).toLowerCase();
  if (!PREFIXES.has(prefix) || (!allowEntry && prefix === "e")) return null;
  return { id: text, prefix, externalId: text.slice(separator + 2) };
}

export function requireItemId(value, label = "item id") {
  const parsed = parseId(value);
  if (!parsed) throw new UsageError(`${label} must be a compound item id such as l::<uuid>`);
  return parsed;
}

export function normalizeBarcode(value) {
  const text = String(value || "").replace(/[\s-]/g, "");
  return /^\d{8,14}$/.test(text) ? text : null;
}

export function isBarcode(value) {
  return normalizeBarcode(value) !== null;
}
