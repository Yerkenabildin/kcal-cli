import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kcal-read-search-"));
process.env.KCAL_DB_FILE = path.join(tmp, "missing.sqlite3");
process.env.YAZIO_TOKEN_FILE = path.join(tmp, "missing-token.json");
process.env.KCAL_OFF_API_URL = "https://off.test";
process.env.YAZIO_RETRIES = "0";

const searchCommand = await import("../src/commands/search-local.mjs");
const realFetch = globalThis.fetch;

afterEach(() => { globalThis.fetch = realFetch; });

test("remote search does not create SQLite just to cache a read", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ products: [] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  const result = await searchCommand.run(["nothing-local"], {});
  assert.deepEqual(result.items, []);
  assert.equal(fs.existsSync(process.env.KCAL_DB_FILE), false);
});
