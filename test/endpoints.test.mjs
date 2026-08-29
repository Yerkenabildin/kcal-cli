import { test } from "node:test";
import assert from "node:assert/strict";
import { ENDPOINTS, endpoint, expandPath } from "../src/endpoints.mjs";

test("every registered path is a /v22/ path the client will accept", () => {
  for (const [name, op] of Object.entries(ENDPOINTS)) {
    assert.match(op.path, /^\/v22\//, `${name} must live under /v22/`);
    assert.ok(["GET", "POST", "DELETE"].includes(op.method), `${name} has an unexpected method`);
  }
});

test("only the token exchange is unauthenticated", () => {
  const open = Object.entries(ENDPOINTS).filter(([, op]) => op.auth === false).map(([name]) => name);
  assert.deepEqual(open, ["auth.token"]);
});

test("no write is marked replay-safe", () => {
  for (const [name, op] of Object.entries(ENDPOINTS)) {
    if (op.method === "GET") continue;
    assert.equal(op.replaySafe, false, `${name} must not be replay-safe: this API has no idempotent write`);
  }
});

test("reads are replay-safe so a flaky network does not fail a lookup", () => {
  for (const [name, op] of Object.entries(ENDPOINTS)) {
    if (op.method !== "GET") continue;
    assert.equal(op.replaySafe, true, `${name} should be retryable`);
  }
});

test("deleting a diary entry is the only destructive operation", () => {
  const destructive = Object.entries(ENDPOINTS).filter(([, op]) => op.destructive).map(([name]) => name);
  assert.deepEqual(destructive, ["diary.delete"]);
});

test("the MVP surface is present under the paths the v22 spec documents", () => {
  const expected = {
    "auth.token": ["POST", "/v22/oauth/token"],
    "user.get": ["GET", "/v22/user"],
    "products.search": ["GET", "/v22/products/search"],
    "products.get": ["GET", "/v22/products/{id}"],
    "products.suggested": ["GET", "/v22/user/products/suggested"],
    "diary.day": ["GET", "/v22/user/consumed-items"],
    "diary.add": ["POST", "/v22/user/consumed-items"],
    "diary.delete": ["DELETE", "/v22/user/consumed-items"],
    "diary.nutrients-daily": ["GET", "/v22/user/consumed-items/nutrients-daily"],
    "diary.daily-summary": ["GET", "/v22/user/widgets/daily-summary"],
  };
  for (const [name, [method, path]] of Object.entries(expected)) {
    const op = endpoint(name);
    assert.ok(op, `${name} is missing from the registry`);
    assert.equal(op.method, method, `${name} method`);
    assert.equal(op.path, path, `${name} path`);
  }
  assert.deepEqual(Object.keys(ENDPOINTS).sort(), Object.keys(expected).sort());
});

test("expandPath fills and encodes path parameters", () => {
  assert.equal(expandPath("/v22/products/{id}", { id: "abc-123" }), "/v22/products/abc-123");
  assert.equal(expandPath("/v22/products/{id}", { id: "a/b" }), "/v22/products/a%2Fb");
});

test("a missing path parameter fails loudly instead of building a wrong URL", () => {
  assert.throws(() => expandPath("/v22/products/{id}", {}), /missing path parameter: id/);
  assert.throws(() => expandPath("/v22/products/{id}", { id: "" }), /missing path parameter: id/);
});

test("an unknown operation name is not silently ignored", () => {
  assert.equal(endpoint("diary.nope"), null);
});
