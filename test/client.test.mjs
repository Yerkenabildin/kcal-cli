import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "yazio-client-"));
process.env.YAZIO_TOKEN_FILE = path.join(tmp, "token.json");
process.env.YAZIO_API_URL = "https://api.test";
process.env.YAZIO_RETRIES = "0";
process.env.YAZIO_USER_AGENT = "YAZIO/26.30.1 (test) Ktor";
process.env.YAZIO_ACCEPT_LANGUAGE = "nl-NL,nl;q=0.9,en;q=0.8";

const { saveTokens } = await import("../src/auth.mjs");
const { request } = await import("../src/client.mjs");
const { ApiChangedError, ApiError, AuthError, RateLimitError, UnsafeReplayError, UsageError } =
  await import("../src/errors.mjs");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(process.env.YAZIO_TOKEN_FILE, { force: true });
});

function response(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null, entries: () => Object.entries(headers) },
    text: async () => (body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function authenticate() {
  saveTokens({ access_token: "A", refresh_token: "R", expires_in: 3600 });
}

test("a request carries the bearer token, app User-Agent and Accept-Language", async () => {
  authenticate();
  let seen;
  globalThis.fetch = async (url, opts) => { seen = { url: String(url), opts }; return response(200, {}); };
  await request("/v22/user");
  assert.equal(seen.opts.headers.Authorization, "Bearer A");
  assert.match(seen.opts.headers["User-Agent"], /^YAZIO\//);
  assert.equal(seen.opts.headers["Accept-Language"], "nl-NL,nl;q=0.9,en;q=0.8");
});

test("query values are appended, repeated values preserved", async () => {
  authenticate();
  let seen;
  globalThis.fetch = async (url) => { seen = String(url); return response(200, []); };
  await request("/v22/products/search", { query: { query: "kwark", sex: "male", countries: "NL", locales: ["nl_NL", "en_NL"] } });
  const params = new URL(seen).searchParams;
  assert.equal(params.get("query"), "kwark");
  assert.equal(params.get("countries"), "NL");
  assert.deepEqual(params.getAll("locales"), ["nl_NL", "en_NL"]);
});

test("a JSON body is serialised with the right content type", async () => {
  authenticate();
  let seen;
  globalThis.fetch = async (_url, opts) => { seen = opts; return response(204); };
  await request("/v22/user/consumed-items", { method: "POST", json: { products: [] }, replaySafe: false });
  assert.equal(seen.body, '{"products":[]}');
  assert.match(seen.headers["Content-Type"], /application\/json/);
});

test("204 with an empty body is success, not a parse failure", async () => {
  authenticate();
  globalThis.fetch = async () => response(204);
  assert.equal(await request("/v22/user/consumed-items", { method: "DELETE", json: { products: "X" }, replaySafe: false }), null);
});

test("an HTML error page becomes an ApiError rather than a crash", async () => {
  authenticate();
  globalThis.fetch = async () => response(502, "<html>bad gateway</html>");
  await assert.rejects(() => request("/v22/user", { retries: 0 }), ApiError);
});

test("version_blocked becomes api_changed and names the User-Agent, not the token", async () => {
  authenticate();
  globalThis.fetch = async () => response(403, { error: "version_blocked" });
  await assert.rejects(() => request("/v22/user"), (error) => {
    assert.ok(error instanceof ApiChangedError);
    assert.equal(error.exitCode, 7);
    assert.match(error.details.user_agent, /^YAZIO\//);
    assert.ok(!JSON.stringify(error.details).includes("Bearer A"));
    return true;
  });
});

test("a plain 403 is not mistaken for a blocked version", async () => {
  authenticate();
  globalThis.fetch = async () => response(403, { error: "access_denied" });
  await assert.rejects(() => request("/v22/user"), ApiError);
});

test("429 becomes a rate-limit error carrying retry-after", async () => {
  authenticate();
  globalThis.fetch = async () => response(429, { error: "slow down" }, { "retry-after": "17" });
  await assert.rejects(() => request("/v22/user", { retries: 0 }), (error) => {
    assert.ok(error instanceof RateLimitError);
    assert.equal(error.retryAfter, 17);
    return true;
  });
});

test("a safe read is retried after a network failure", async () => {
  authenticate();
  let calls = 0;
  globalThis.fetch = async () => { calls++; if (calls === 1) throw new Error("network down"); return response(200, { ok: true }); };
  assert.deepEqual(await request("/v22/user", { retries: 2 }), { ok: true });
  assert.equal(calls, 2);
});

test("an unsafe write is never replayed after a network failure", async () => {
  authenticate();
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("network down"); };
  await assert.rejects(
    () => request("/v22/user/consumed-items", { method: "POST", json: {}, replaySafe: false, retries: 3 }),
    UnsafeReplayError,
  );
  assert.equal(calls, 1, "a second POST is how you log dinner twice");
});

test("a 401 during an unsafe write is reported, not retried with a fresh token", async () => {
  authenticate();
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response(401, { error: "unauthorized" }); };
  await assert.rejects(
    () => request("/v22/user/consumed-items", { method: "POST", json: {}, replaySafe: false }),
    UnsafeReplayError,
  );
  assert.equal(calls, 1);
});

test("a 401 on a read refreshes once and retries", async () => {
  saveTokens({ access_token: "OLD", refresh_token: "R", expires_in: 3600 });
  let calls = 0;
  globalThis.fetch = async (url, opts) => {
    calls++;
    if (String(url).includes("/oauth/token")) return response(200, { access_token: "NEW", refresh_token: "R2", expires_in: 3600 });
    if (opts.headers.Authorization === "Bearer OLD") return response(401, { error: "unauthorized" });
    return response(200, { refreshed: true });
  };
  assert.deepEqual(await request("/v22/user"), { refreshed: true });
  assert.equal(calls, 3);
});

test("missing credentials fail before any request is made", async () => {
  globalThis.fetch = async () => { throw new Error("must not reach the network"); };
  await assert.rejects(() => request("/v22/user"), AuthError);
});

for (const [label, badPath] of [
  ["protocol-relative", "//evil.test/v22/user"],
  ["absolute", "https://evil.test/v22/user"],
  ["backslash", "/v22\\user"],
  ["traversal", "/v22/../v15/user"],
  ["outside /v22/", "/v15/user"],
  ["relative", "v22/user"],
]) {
  test(`a ${label} path is rejected before the token is attached`, async () => {
    saveTokens({ access_token: "SECRET", refresh_token: "R", expires_in: 3600 });
    let calls = 0;
    globalThis.fetch = async () => { calls++; return response(200, {}); };
    await assert.rejects(() => request(badPath), UsageError);
    assert.equal(calls, 0, "the token must never leave for an unvalidated path");
  });
}
