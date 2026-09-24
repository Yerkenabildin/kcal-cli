import { beforeEach, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kcal-scan-"));
process.env.KCAL_DB_FILE = path.join(tmp, "kcal.sqlite3");
process.env.OPENROUTER_API_KEY = "test-key";
process.env.KCAL_OPENROUTER_API_URL = "https://openrouter.test";

const imagePath = path.join(tmp, "label.png");
fs.writeFileSync(imagePath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));

const { closeDatabase, openDatabase } = await import("../src/db.mjs");
const { scanImage } = await import("../src/services/scan-service.mjs");
const { materializeItem } = await import("../src/services/catalog-service.mjs");
const itemCommand = await import("../src/commands/item.mjs");
const { addDiaryEntry } = await import("../src/local-diary.mjs");
const { UsageError } = await import("../src/errors.mjs");

const realFetch = globalThis.fetch;
let requestBody;
let labelResult;

beforeEach(() => {
  closeDatabase();
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${process.env.KCAL_DB_FILE}${suffix}`, { force: true });
  requestBody = null;
  labelResult = {
    name: "Lentil bread", brand: null, state: "as_sold",
    basis: { amount: 100, unit: "g" },
    nutrients: { energy_kj: null, energy_kcal: 240, protein_g: 18, fat_g: 5, carb_g: 31, fiber_g: 9 },
    portions: [], barcodes: [], category: "bread", warnings: [], needs_review: false,
  };
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        model: "cheap/vision",
        usage: { prompt_tokens: 10, completion_tokens: 20 },
        choices: [{ message: { content: JSON.stringify(labelResult) } }],
      }),
    };
  };
});

afterEach(() => { globalThis.fetch = realFetch; });

test("scan falls back to structured OpenRouter label recognition and stores no image blob", async () => {
  const db = openDatabase();
  const result = await scanImage(db, imagePath, { hint: "lentil bread" });
  assert.equal(result.mode, "label");
  assert.match(result.item.id, /^scan::/);
  assert.equal(result.item.status, "active");
  assert.equal(requestBody.provider.data_collection, "deny");
  assert.equal(requestBody.provider.zdr, true);
  assert.equal(requestBody.plugins[0].cost_tier, "low");
  assert.match(requestBody.messages[0].content[0].text, /lentil bread/);
  const columns = db.prepare("PRAGMA table_info(scan_results)").all().map((row) => row.name);
  assert.ok(!columns.includes("image"));
  const item = await materializeItem(db, result.item.id);
  assert.equal(item.per_100.energy_kcal, 240);
});

test("an incomplete label is blocked until item update supplies the missing value", async () => {
  labelResult.nutrients.protein_g = null;
  const db = openDatabase();
  const result = await scanImage(db, imagePath, { hint: "lentil bread" });
  assert.equal(result.item.status, "needs_review");
  await assert.rejects(materializeItem(db, result.item.id), UsageError);
  await assert.rejects(
    addDiaryEntry(db, result.item.id, {
      amount: 100, unit: "g", meal: "lunch", date: "2026-09-24",
    }),
    /needs review/,
  );

  const updated = await itemCommand.run(
    ["update", result.item.id],
    { set: "nutrients.protein_g=18" },
  );
  assert.equal(updated.item.status, "active");
  const logged = await addDiaryEntry(db, result.item.id, {
    amount: 100, unit: "g", meal: "lunch", date: "2026-09-24",
  });
  assert.equal(logged.entry.nutrients.protein_g, 18);
});

test("incompatible printed kJ and kcal values require review", async () => {
  labelResult.nutrients.energy_kj = 2000;
  const result = await scanImage(openDatabase(), imagePath);
  assert.equal(result.item.status, "needs_review");
  assert.ok(result.item.warnings.some((warning) => /kJ.*kcal/i.test(warning)));
});
