import { UsageError } from "./errors.mjs";

export function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) { positionals.push(arg); continue; }
    const eq = arg.indexOf("=");
    if (eq >= 0) { assignFlag(flags, arg.slice(2, eq), arg.slice(eq + 1)); continue; }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !/^--[A-Za-z]/.test(next)) { assignFlag(flags, key, next); i++; }
    else assignFlag(flags, key, true);
  }
  return { positionals, flags };
}

function assignFlag(flags, key, value) {
  if (!(key in flags)) flags[key] = value;
  else if (Array.isArray(flags[key])) flags[key].push(value);
  else flags[key] = [flags[key], value];
}

export function printJson(value, stream = process.stdout) {
  stream.write(JSON.stringify(value, null, 2) + "\n");
}

export function toInt(value, label, { min, max } = {}) {
  if (value === undefined || value === true) throw new UsageError(`${label} requires a value`);
  const n = Number(value);
  if (!Number.isInteger(n)) throw new UsageError(`${label} must be an integer, got: ${value}`);
  if (min !== undefined && n < min) throw new UsageError(`${label} must be >= ${min}`);
  if (max !== undefined && n > max) throw new UsageError(`${label} must be <= ${max}`);
  return n;
}

export function toNumber(value, label, { min, max, exclusiveMin } = {}) {
  if (value === undefined || value === true) throw new UsageError(`${label} requires a value`);
  const n = Number(value);
  if (!Number.isFinite(n)) throw new UsageError(`${label} must be a number, got: ${value}`);
  if (exclusiveMin !== undefined && n <= exclusiveMin) throw new UsageError(`${label} must be > ${exclusiveMin}`);
  if (min !== undefined && n < min) throw new UsageError(`${label} must be >= ${min}`);
  if (max !== undefined && n > max) throw new UsageError(`${label} must be <= ${max}`);
  return n;
}

export function toBool(value, label) {
  if (value === true) return true;
  if (/^(1|true|yes|on)$/i.test(String(value))) return true;
  if (/^(0|false|no|off)$/i.test(String(value))) return false;
  throw new UsageError(`${label} must be a boolean`);
}

export function toStringFlag(value, label) {
  if (value === undefined) return undefined;
  if (value === true || value === "") throw new UsageError(`${label} requires a value`);
  if (Array.isArray(value)) throw new UsageError(`${label} was given more than once`);
  return String(value);
}

export function parseJsonObject(value, label = "value") {
  if (value === undefined || value === true || value === "") return {};
  let parsed;
  try { parsed = JSON.parse(value); } catch (error) { throw new UsageError(`invalid JSON for ${label}: ${error.message}`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new UsageError(`${label} must be a JSON object`);
  return parsed;
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason || new Error("aborted")); }, { once: true });
  });
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// YAZIO addresses a diary day by plain date but stamps each written entry with a full
// local timestamp, so the two formats are not interchangeable and both live here.
export function toDateString(value, label = "--date") {
  if (value === undefined) return localDate(new Date());
  if (value === true) throw new UsageError(`${label} requires a value`);
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new UsageError(`${label} must be YYYY-MM-DD, got: ${text}`);
  const parsed = new Date(`${text}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) throw new UsageError(`${label} is not a real date: ${text}`);
  return text;
}

export function localDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Logging against today records the time it actually happened. Logging against another
// day uses midday: it lands on the right date under any timezone the app later renders
// it in, without pretending to a precision we do not have.
export function entryTimestamp(dateString, now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  if (dateString === localDate(now)) {
    return `${dateString} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }
  return `${dateString} 12:00:00`;
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

export function toTimestamp(value, label = "--at") {
  const text = String(value).trim();
  if (!TIMESTAMP.test(text)) throw new UsageError(`${label} must be "YYYY-MM-DD HH:MM:SS", got: ${text}`);
  return text;
}

export function dateOfTimestamp(value) {
  const text = String(value || "");
  return TIMESTAMP.test(text) ? text.slice(0, 10) : (/^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null);
}

export function round(value, digits = 2) {
  if (!Number.isFinite(value)) return value;
  const rounded = Number(value.toFixed(digits));
  // A micronutrient in grams is ~1e-4: rounding it to two places reports "contains none"
  // rather than "too small to show". Fall back to three significant digits instead.
  if (rounded === 0 && value !== 0) return Number(value.toPrecision(3));
  return rounded;
}

export function roundDeep(value, digits = 2) {
  if (typeof value === "number") return round(value, digits);
  if (Array.isArray(value)) return value.map((item) => roundDeep(item, digits));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = roundDeep(item, digits);
    return out;
  }
  return value;
}
