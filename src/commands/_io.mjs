import fs from "node:fs";
import { UsageError } from "../errors.mjs";

async function stdinText() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

export async function readJsonInput(value, label = "--file") {
  if (value === undefined || value === true || value === "") throw new UsageError(`${label} requires a path or - for stdin`);
  let text;
  try { text = value === "-" ? await stdinText() : fs.readFileSync(String(value), "utf8"); }
  catch (error) { throw new UsageError(`cannot read ${value}: ${error.message}`); }
  try { return JSON.parse(text); }
  catch (error) { throw new UsageError(`invalid JSON in ${value}: ${error.message}`); }
}

export function setValues(raw) {
  if (raw === undefined) throw new UsageError("give at least one --set key=value");
  const values = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (const value of values) {
    const separator = String(value).indexOf("=");
    if (separator <= 0) throw new UsageError(`--set must be key=value; got: ${value}`);
    const key = String(value).slice(0, separator);
    const text = String(value).slice(separator + 1);
    let parsed = text;
    try { parsed = JSON.parse(text); } catch {}
    out.push([key, parsed]);
  }
  return out;
}

export function assignPath(target, key, value) {
  const allowed = new Set([
    "name", "brand", "state", "category", "basis.amount", "basis.unit",
    "nutrients.energy_kcal", "nutrients.protein_g", "nutrients.fat_g",
    "nutrients.carb_g", "nutrients.fiber_g",
  ]);
  if (!allowed.has(key)) throw new UsageError(`unsupported --set field: ${key}`, { allowed_fields: [...allowed] });
  const parts = key.split(".");
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index++) cursor = cursor[parts[index]];
  cursor[parts.at(-1)] = value;
}
