import fs from "node:fs";
import path from "node:path";
import { AuthError, UsageError } from "../errors.mjs";
import { OPENROUTER_API_KEY, OPENROUTER_API_URL, OPENROUTER_MODEL } from "../config.mjs";
import { normalizeBarcode } from "../ids.mjs";
import { LABEL_SCHEMA, validateLabel } from "../schemas.mjs";
import { fetchJson } from "./http.mjs";

function mimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if ([".jpg", ".jpeg"].includes(extension)) return "image/jpeg";
  throw new UsageError("scan supports PNG, JPEG, WEBP, or GIF images");
}

function contentText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part?.text || "").join("");
  return "";
}

export async function recognizeNutritionLabel(filePath, { hint, barcodePayload } = {}) {
  if (!OPENROUTER_API_KEY) {
    throw new AuthError("OpenRouter is required when no usable product barcode was found", {
      hint: "set OPENROUTER_API_KEY",
    });
  }
  let image;
  try { image = fs.readFileSync(filePath); }
  catch (error) { throw new UsageError(`cannot read image: ${error.message}`); }
  const prompt = [
    "Extract the nutrition label into the requested JSON schema.",
    "Prefer values for the product as sold and per 100 g or 100 ml; otherwise preserve the printed serving basis.",
    "Return both printed energy_kj and energy_kcal when present. Do not infer missing macro values. Use null and needs_review=true when uncertain.",
    "fiber_g may be null when the label does not state fibre.",
    hint ? `User hint: ${hint}` : null,
    barcodePayload ? `Barcode or QR payload detected locally: ${barcodePayload}` : null,
  ].filter(Boolean).join("\n");
  const body = {
    model: OPENROUTER_MODEL,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: `data:${mimeType(filePath)};base64,${image.toString("base64")}` } },
      ],
    }],
    response_format: { type: "json_schema", json_schema: LABEL_SCHEMA },
    provider: { require_parameters: true, data_collection: "deny", zdr: true },
    temperature: 0,
  };
  if (OPENROUTER_MODEL === "openrouter/auto") {
    body.plugins = [{ id: "auto-router", cost_tier: "low" }];
  }
  const payload = await fetchJson(new URL("/api/v1/chat/completions", OPENROUTER_API_URL), {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = contentText(payload?.choices?.[0]?.message?.content);
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new UsageError("OpenRouter returned invalid JSON for the nutrition label"); }
  validateLabel(parsed);
  const energyKj = parsed.nutrients.energy_kj;
  const energyKcal = parsed.nutrients.energy_kcal;
  if (typeof energyKj === "number" && typeof energyKcal === "number") {
    const converted = energyKj / 4.184;
    const tolerance = Math.max(2, converted * 0.1);
    if (Math.abs(converted - energyKcal) > tolerance) {
      parsed.needs_review = true;
      parsed.warnings.push("printed kJ and kcal energy values are incompatible");
    }
  }
  parsed.barcodes = [...new Set(parsed.barcodes.map(normalizeBarcode).filter(Boolean))];
  return { result: parsed, model: payload?.model || OPENROUTER_MODEL, usage: payload?.usage || null };
}

export function labelToProduct(result) {
  const required = [result?.name, result?.basis?.amount, result?.basis?.unit,
    result?.nutrients?.energy_kcal, result?.nutrients?.protein_g,
    result?.nutrients?.fat_g, result?.nutrients?.carb_g];
  const missing = required.some((value) => value === null || value === undefined || value === "");
  const needsReview = Boolean(result?.needs_review || missing || Number(result?.basis?.amount) <= 0);
  if (needsReview) return { document: null, needsReview: true };
  return {
    needsReview: false,
    document: {
      schema_version: 1,
      kind: "food",
      name: result.name,
      aliases: [],
      brand: result.brand ?? null,
      barcodes: result.barcodes || [],
      state: result.state || "unknown",
      basis: result.basis,
      nutrients: {
        energy_kcal: result.nutrients.energy_kcal,
        protein_g: result.nutrients.protein_g,
        fat_g: result.nutrients.fat_g,
        carb_g: result.nutrients.carb_g,
        fiber_g: result.nutrients.fiber_g,
      },
      other_nutrients: typeof result.nutrients.energy_kj === "number"
        ? { energy_kj: result.nutrients.energy_kj }
        : {},
      portions: result.portions || [],
      category: result.category ?? null,
      tags: [],
    },
  };
}
