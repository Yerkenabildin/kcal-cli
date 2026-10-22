import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { AmbiguousMatchError, UsageError } from "../errors.mjs";
import { createId, normalizeBarcode } from "../ids.mjs";
import { labelToProduct, recognizeNutritionLabel } from "../providers/openrouter.mjs";
import { searchCatalog } from "./catalog-service.mjs";

let zxingPrepared = false;

function prepareZxing() {
  if (zxingPrepared) return;
  const wasmPath = fileURLToPath(import.meta.resolve("zxing-wasm/reader/zxing_reader.wasm"));
  const wasmBinary = fs.readFileSync(wasmPath);
  prepareZXingModule({ overrides: { wasmBinary } });
  zxingPrepared = true;
}

async function decodeCodes(buffer) {
  prepareZxing();
  const results = await readBarcodes(new Uint8Array(buffer), {
    formats: ["EAN8", "EAN13", "UPCA", "UPCE", "QRCode"],
    tryHarder: true,
    tryRotate: true,
    tryInvert: true,
    maxNumberOfSymbols: 8,
  });
  return results.map((result) => ({ text: result.text, format: result.format })).filter((result) => result.text);
}

const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export async function scanImage(db, filePath, {
  hint, limit = 10, allowAi = false, maxImageBytes = DEFAULT_MAX_IMAGE_BYTES,
} = {}) {
  let image;
  try { image = fs.readFileSync(filePath); }
  catch (error) { throw new UsageError(`cannot read image: ${error.message}`); }
  if (image.byteLength > maxImageBytes) {
    throw new UsageError(`image is too large: ${image.byteLength} bytes (maximum ${maxImageBytes})`);
  }
  let decoded = [];
  let barcodeError = null;
  try { decoded = await decodeCodes(image); }
  catch (error) { barcodeError = error.message; }
  const productCodes = [...new Set(decoded.map((result) => normalizeBarcode(result.text)).filter(Boolean))];
  if (productCodes.length > 1) {
    throw new AmbiguousMatchError("more than one product barcode was found in the image", {
      barcodes: productCodes,
    });
  }
  if (productCodes.length === 1) {
    const search = await searchCatalog(db, productCodes[0], { limit });
    if (search.items.length) {
      return {
        ok: true,
        operation: "scan",
        mode: "barcode",
        image: filePath,
        decoded,
        barcode: productCodes[0],
        items: search.items,
        provider_errors: search.provider_errors,
      };
    }
  }

  if (!allowAi) {
    throw new UsageError("no product match from local barcode scan; rerun with --allow-ai to send the image to OpenRouter");
  }
  const barcodePayload = decoded.map((entry) => entry.text).join(" | ") || null;
  const recognized = await recognizeNutritionLabel(filePath, { hint, barcodePayload, image });
  const converted = labelToProduct(recognized.result);
  const id = createId("scan");
  const status = converted.needsReview ? "needs_review" : "active";
  const warnings = [
    ...(recognized.result.warnings || []),
    ...(barcodeError ? [`barcode decoder: ${barcodeError}`] : []),
  ];
  const stamp = new Date().toISOString();
  db.prepare(`INSERT INTO scan_results(
    id, image_sha256, source_path, barcode_payload, hint, model, status, result_json, warnings_json, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, crypto.createHash("sha256").update(image).digest("hex"), filePath, barcodePayload,
    hint || null, recognized.model, status,
    JSON.stringify({ raw: recognized.result, document: converted.document }), JSON.stringify(warnings), stamp,
  );
  return {
    ok: true,
    operation: "scan",
    mode: "label",
    image: filePath,
    item: {
      id,
      status,
      ...recognized.result,
      warnings,
      model: recognized.model,
    },
    usage: recognized.usage,
  };
}
