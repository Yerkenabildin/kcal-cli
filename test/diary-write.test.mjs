import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "yazio-write-"));
process.env.YAZIO_TOKEN_FILE = path.join(tmp, "token.json");
process.env.YAZIO_STATE_DIR = path.join(tmp, "state");
process.env.YAZIO_API_URL = "https://api.test";
process.env.YAZIO_RETRIES = "0";

const { saveTokens } = await import("../src/auth.mjs");
const diary = await import("../src/commands/diary.mjs");
const { deriveEntryId } = await import("../src/state/operation-ledger.mjs");
const { UsageError, WriteResultUnknownError } = await import("../src/errors.mjs");

const PRODUCT_ID = "75eb5707-ebeb-4eae-9187-74538d9edaf1";
const PRODUCT = {
  name: "Egg", producer: null, base_unit: "g", is_verified: false, is_private: false,
  is_deleted: false, category: "bakingingredients", eans: [], countries: ["NL"], language: "en",
  servings: [{ serving: "whole", amount: 60 }],
  nutrients: { "energy.energy": 1.55, "nutrient.protein": 0.13 },
};

const realFetch = globalThis.fetch;
let api;

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null, entries: () => [] },
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  };
}

// A small stateful stand-in for the diary: writes land in `products`, reads see what landed.
function fakeApi({ onPost, baseUnit } = {}) {
  const state = {
    products: [], posts: [], calls: [], deletes: [],
  };
  globalThis.fetch = async (url, opts = {}) => {
    const target = new URL(String(url));
    const method = opts.method ?? "GET";
    state.calls.push(`${method} ${target.pathname}`);

    if (target.pathname === `/v22/products/${PRODUCT_ID}`) {
      return response(200, baseUnit ? { ...PRODUCT, base_unit: baseUnit } : PRODUCT);
    }
    if (target.pathname.startsWith("/v22/products/")) return response(404, { error: "not found" });
    if (target.pathname === "/v22/user/consumed-items" && method === "GET") {
      return response(200, { products: state.products, recipe_portions: [], simple_products: [] });
    }
    if (target.pathname === "/v22/user/consumed-items" && method === "POST") {
      const body = JSON.parse(opts.body);
      state.posts.push(body);
      if (onPost) {
        const outcome = onPost(body, state);
        if (outcome === "throw") throw new Error("network down");
        if (outcome === "silent") return response(204);
      }
      state.products.push(...body.products);
      return response(204);
    }
    if (target.pathname === "/v22/user/consumed-items" && method === "DELETE") {
      const body = JSON.parse(opts.body);
      state.deletes.push(body);
      // The real endpoint answers 204 whether or not it removed anything: a wrong bucket is a
      // silent no-op, and so is an ?id= query parameter.
      const id = body.products ?? null;
      if (id && !target.searchParams.has("id")) {
        state.products = state.products.filter((item) => item.id !== id);
      }
      return response(204);
    }
    if (target.pathname === "/v22/user/widgets/daily-summary") {
      const energy = state.products.reduce((total, item) => total + item.amount * 1.55, 0);
      const protein = state.products.reduce((total, item) => total + item.amount * 0.13, 0);
      return response(200, {
        goals: { "energy.energy": 1940, "nutrient.protein": 94 },
        meals: {
          breakfast: { energy_goal: 582, nutrients: { "energy.energy": energy, "nutrient.protein": protein } },
          lunch: { energy_goal: 0, nutrients: {} },
          dinner: { energy_goal: 0, nutrients: {} },
          snack: { energy_goal: 0, nutrients: {} },
        },
      });
    }
    throw new Error(`unexpected call: ${method} ${target.pathname}`);
  };
  return state;
}

beforeEach(() => {
  saveTokens({ access_token: "A", refresh_token: "R", expires_in: 3600 });
  fs.rmSync(process.env.YAZIO_STATE_DIR, { recursive: true, force: true });
});
afterEach(() => { globalThis.fetch = realFetch; });

const add = (flags) => diary.run(["add-product", PRODUCT_ID], flags);

test("logging by grams writes once and verifies by reading the day back", async () => {
  const state = fakeApi();
  const result = await add({ meal: "breakfast", amount: "150", date: "2026-08-29" });

  assert.equal(result.changed, true);
  assert.equal(result.verified, true);
  assert.equal(result.target.amount, 150);
  assert.equal(result.target.daytime, "breakfast");
  assert.equal(Math.round(result.entry.nutrients.energy_kcal), 233);
  assert.equal(state.posts.length, 1, "exactly one write");
  assert.deepEqual(
    state.calls.filter((c) => c.startsWith("GET /v22/user/consumed-items")).length, 2,
    "the day is read before and after the write",
  );
});

test("the entry id is derived, so the same operation cannot create a second entry", async () => {
  const state = fakeApi();
  const first = await add({ meal: "breakfast", amount: "150", date: "2026-08-29" });
  const second = await add({ meal: "breakfast", amount: "150", date: "2026-08-29" });

  assert.equal(first.entry.id, second.entry.id);
  assert.equal(second.changed, false);
  assert.equal(second.already_logged, true);
  assert.equal(state.posts.length, 1, "the repeat must not reach the API");
  assert.equal(state.products.length, 1);
});

test("a different amount is a different entry, not a repeat", async () => {
  const state = fakeApi();
  const first = await add({ meal: "breakfast", amount: "150", date: "2026-08-29" });
  const second = await add({ meal: "breakfast", amount: "200", date: "2026-08-29" });
  assert.notEqual(first.entry.id, second.entry.id);
  assert.equal(state.posts.length, 2);
});

test("a derived id is an uppercase v4-shaped UUID, which is what the app sends", () => {
  const id = deriveEntryId("diary.add-product|2026-08-29|breakfast|abc|150");
  assert.match(id, /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
  assert.equal(id, deriveEntryId("diary.add-product|2026-08-29|breakfast|abc|150"), "must be stable");
});

test("a named serving is multiplied out from the product's own table", async () => {
  const state = fakeApi();
  const result = await add({ meal: "breakfast", serving: "whole", "serving-quantity": "3", date: "2026-08-29" });
  assert.equal(result.target.amount, 180, "three 60 g servings");
  assert.equal(state.posts[0].products[0].serving, "whole");
  assert.equal(state.posts[0].products[0].serving_quantity, 3);
});

test("logging by weight is labelled the way the app labels it", async () => {
  // Omitting the field stores a null serving, which leaves the entry without a portion label.
  // Checked live: the app writes serving "gram" with the amount as the quantity.
  const state = fakeApi();
  const result = await add({ meal: "breakfast", amount: "150", date: "2026-08-29" });
  const written = state.posts[0].products[0];
  assert.equal(written.serving, "gram");
  assert.equal(written.serving_quantity, 150);
  assert.equal(written.amount, 150);
  assert.equal(result.target.serving_derived_from_base_unit, true, "not a portion the caller chose");
});

test("a millilitre product is labelled in millilitres, tracking its base unit", async () => {
  const state = fakeApi({ baseUnit: "ml" });
  await add({ meal: "breakfast", amount: "200", date: "2026-08-29" });
  assert.equal(state.posts[0].products[0].serving, "milliliter");
  assert.equal(state.posts[0].products[0].serving_quantity, 200);
});

test("an unfamiliar base unit gets no label rather than an invented one", async () => {
  const state = fakeApi({ baseUnit: "piece" });
  await add({ meal: "breakfast", amount: "2", date: "2026-08-29" });
  const written = state.posts[0].products[0];
  assert.ok(!("serving" in written), "the app would not use a name we made up");
});

test("a named serving still wins over the derived label", async () => {
  const state = fakeApi();
  const result = await add({ meal: "breakfast", serving: "whole", "serving-quantity": "2", date: "2026-08-29" });
  assert.equal(state.posts[0].products[0].serving, "whole");
  assert.equal(state.posts[0].products[0].serving_quantity, 2);
  assert.equal(result.target.serving_derived_from_base_unit, undefined);
});

test("a serving the product does not offer is refused, not guessed", async () => {
  fakeApi();
  await assert.rejects(
    () => add({ meal: "breakfast", serving: "slice", date: "2026-08-29" }),
    (error) => {
      assert.ok(error instanceof UsageError);
      assert.deepEqual(error.details.available_servings, ["whole"]);
      return true;
    },
  );
});

test("the written timestamp is a full local stamp, while the read is a plain date", async () => {
  const state = fakeApi();
  await add({ meal: "breakfast", amount: "150", date: "2026-08-28" });
  assert.match(state.posts[0].products[0].date, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(state.posts[0].products[0].date, "2026-08-28 12:00:00", "another day is stamped at midday");
});

test("the write body carries all three buckets", async () => {
  const state = fakeApi();
  await add({ meal: "breakfast", amount: "150", date: "2026-08-29" });
  assert.deepEqual(Object.keys(state.posts[0]).sort(), ["products", "recipe_portions", "simple_products"]);
});

test("an unknown meal is rejected before anything is sent", async () => {
  const state = fakeApi();
  await assert.rejects(() => add({ meal: "brunch", amount: "150" }), UsageError);
  assert.equal(state.calls.length, 0, "YAZIO accepts an unknown daytime silently, so we must not send one");
});

test("a missing amount is rejected before anything is sent", async () => {
  const state = fakeApi();
  await assert.rejects(() => add({ meal: "breakfast" }), UsageError);
  assert.equal(state.calls.length, 0);
});

test("a product name where an id belongs is refused", async () => {
  const state = fakeApi();
  await assert.rejects(
    () => diary.run(["add-product", "magere kwark"], { meal: "breakfast", amount: "150" }),
    (error) => { assert.match(error.message, /product id, not a name/); return true; },
  );
  assert.equal(state.calls.length, 0);
});

test("a write whose outcome is unknown is never sent again", async () => {
  const state = fakeApi({ onPost: () => "throw" });
  await assert.rejects(
    () => add({ meal: "breakfast", amount: "150", date: "2026-08-29" }),
    (error) => {
      assert.ok(error instanceof WriteResultUnknownError);
      assert.equal(error.exitCode, 6);
      assert.match(error.details.retry_command, /--op-key/);
      return true;
    },
  );
  assert.equal(state.posts.length, 1, "a second POST is how you log dinner twice");
});

test("an uncertain write that did land is recovered by reading it back, not resent", async () => {
  // The POST reaches YAZIO and is applied, but the response never gets home.
  const state = fakeApi({
    onPost: (body, s) => { s.products.push(...body.products); return "throw"; },
  });
  const result = await add({ meal: "breakfast", amount: "150", date: "2026-08-29" });
  assert.equal(result.verified, true);
  assert.equal(state.posts.length, 1);
  assert.equal(state.products.length, 1, "no duplicate was created recovering from the unknown outcome");
});

test("a 204 that changed nothing is reported as unknown, not as success", async () => {
  // The API answers 204 whether or not it did anything, so the read-back is the only truth.
  const state = fakeApi({ onPost: () => "silent" });
  await assert.rejects(
    () => add({ meal: "breakfast", amount: "150", date: "2026-08-29" }),
    WriteResultUnknownError,
  );
  assert.equal(state.products.length, 0);
});

test("day totals come back with the write, summed from the four meal slots", async () => {
  fakeApi();
  const result = await add({ meal: "breakfast", amount: "150", date: "2026-08-29" });
  assert.equal(Math.round(result.day_totals.energy_kcal), 233);
  assert.equal(result.goals.energy_kcal, 1940);
});

const removeEntry = (id, flags) => diary.run(["remove", id], flags);

test("removing an entry finds its bucket, deletes once, and confirms it is gone", async () => {
  const state = fakeApi();
  const written = await add({ meal: "breakfast", amount: "150", date: "2026-08-29" });

  const result = await removeEntry(written.entry.id, { date: "2026-08-29", yes: true });
  assert.equal(result.changed, true);
  assert.equal(result.verified, true);
  assert.equal(result.bucket, "products", "the bucket is discovered, not supplied");
  assert.equal(state.deletes.length, 1);
  assert.deepEqual(Object.keys(state.deletes[0]), ["products"]);
  assert.equal(typeof state.deletes[0].products, "string", "an array is rejected by the API");
  assert.equal(state.products.length, 0);
});

test("removing without --yes asks for confirmation and sends nothing", async () => {
  const state = fakeApi();
  const written = await add({ meal: "breakfast", amount: "150", date: "2026-08-29" });
  const callsBefore = state.calls.length;

  await assert.rejects(
    () => removeEntry(written.entry.id, { date: "2026-08-29" }),
    (error) => {
      assert.equal(error.exitCode, 4);
      assert.match(error.details.retry_command, /--yes$/);
      return true;
    },
  );
  assert.equal(state.calls.length, callsBefore, "nothing is read or written without confirmation");
  assert.equal(state.products.length, 1);
});

test("removing an entry that is not there reports no change rather than failing", async () => {
  const state = fakeApi();
  const result = await removeEntry("DEADBEEF-0000-4000-8000-000000000000", { date: "2026-08-29", yes: true });
  assert.equal(result.changed, false);
  assert.equal(result.already_absent, true);
  assert.equal(state.deletes.length, 0, "there is nothing to delete");
});

test("a delete the API accepted but did not perform is reported as a conflict", async () => {
  // 204 means nothing on this endpoint: it answers the same whether or not it removed a row.
  const state = fakeApi();
  const written = await add({ meal: "breakfast", amount: "150", date: "2026-08-29" });
  const keep = state.products.slice();
  globalThis.fetch = ((inner) => async (url, opts = {}) => {
    if (new URL(String(url)).pathname === "/v22/user/consumed-items" && (opts.method ?? "GET") === "DELETE") {
      state.deletes.push(JSON.parse(opts.body));
      state.products = keep;
      return response(204);
    }
    return inner(url, opts);
  })(globalThis.fetch);

  await assert.rejects(
    () => removeEntry(written.entry.id, { date: "2026-08-29", yes: true }),
    (error) => {
      assert.equal(error.exitCode, 5);
      assert.match(error.message, /still on 2026-08-29/);
      assert.match(error.details.hint, /removed in the app/);
      return true;
    },
  );
});

test("removing needs an entry id, and says where to find one", async () => {
  fakeApi();
  await assert.rejects(() => removeEntry(undefined, { yes: true }), (error) => {
    assert.match(error.details.hint, /yazio diary day/);
    return true;
  });
});
