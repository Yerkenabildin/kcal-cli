import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "yazio-auth-"));
process.env.YAZIO_TOKEN_FILE = path.join(tmp, "cfg", "token.json");
process.env.YAZIO_API_URL = "https://api.test";
process.env.YAZIO_USER_AGENT = "YAZIO/26.30.1 (test) Ktor";

const auth = await import("../src/auth.mjs");
const { ApiChangedError, AuthError } = await import("../src/errors.mjs");
const { _internals } = await import("../src/prompt.mjs");

const TOKEN_FILE = process.env.YAZIO_TOKEN_FILE;
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  fs.rmSync(TOKEN_FILE, { force: true });
  fs.rmSync(`${TOKEN_FILE}.lock`, { force: true });
});

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

test("the password grant posts JSON with the app client credentials", async () => {
  let seen;
  globalThis.fetch = async (url, opts) => {
    seen = { url: String(url), opts };
    return response(200, { access_token: "A", refresh_token: "R", expires_in: 3600, token_type: "Bearer" });
  };
  await auth.exchangePassword("me@example.com", "hunter2");
  assert.equal(seen.url, "https://api.test/v22/oauth/token");
  assert.match(seen.opts.headers["Content-Type"], /application\/json/);
  const body = JSON.parse(seen.opts.body);
  assert.equal(body.grant_type, "password");
  assert.equal(body.username, "me@example.com");
  assert.ok(body.client_id && body.client_secret, "the app credentials must be sent");
});

test("the refresh grant sends the stored refresh token, not the password", async () => {
  let body;
  globalThis.fetch = async (_url, opts) => {
    body = JSON.parse(opts.body);
    return response(200, { access_token: "A2", refresh_token: "R2", expires_in: 3600 });
  };
  await auth.exchangeRefreshToken("R1");
  assert.equal(body.grant_type, "refresh_token");
  assert.equal(body.refresh_token, "R1");
  assert.ok(!("password" in body), "there is no stored password to send");
});

test("expires_at comes from expires_in and falls back to an hour", () => {
  const before = Date.now();
  const withValue = auth.saveTokens({ access_token: "A", refresh_token: "R", expires_in: 7200 });
  assert.ok(Date.parse(withValue.expires_at) - before >= 7199 * 1000);

  const withoutValue = auth.saveTokens({ access_token: "A", refresh_token: "R" });
  const lifetime = Date.parse(withoutValue.expires_at) - Date.now();
  assert.ok(lifetime > 3500 * 1000 && lifetime <= 3600 * 1000, `fallback should be an hour, got ${lifetime}ms`);
});

test("the token file is private and so is its directory", () => {
  auth.saveTokens({ access_token: "A", refresh_token: "R", expires_in: 3600 });
  assert.equal(fs.statSync(TOKEN_FILE).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(TOKEN_FILE)).mode & 0o777, 0o700);
});

test("caching the profile does not move the token's deadline", () => {
  const stored = auth.saveTokens({ access_token: "A", refresh_token: "R", expires_in: 7200 });
  const after = auth.saveProfile({ sex: "male", country: "NL" });
  assert.equal(after.expires_at, stored.expires_at);
  assert.equal(auth.loadProfile().country, "NL");
});

test("a valid token is used as-is, without a network call", async () => {
  auth.saveTokens({ access_token: "A", refresh_token: "R", expires_in: 3600 });
  globalThis.fetch = async () => { throw new Error("must not refresh a valid token"); };
  assert.equal(await auth.ensureAccessToken(), "A");
});

test("an expiring token is refreshed before it is used", async () => {
  auth.saveTokens({ access_token: "OLD", refresh_token: "R", expires_in: 10 });
  globalThis.fetch = async () => response(200, { access_token: "NEW", refresh_token: "R2", expires_in: 3600 });
  assert.equal(await auth.ensureAccessToken(), "NEW");
  assert.equal(auth.loadTokens().refresh_token, "R2");
});

test("concurrent refreshes make one exchange, not a stampede", async () => {
  auth.saveTokens({ access_token: "OLD", refresh_token: "R", expires_in: 10 });
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 10));
    return response(200, { access_token: "NEW", refresh_token: "R2", expires_in: 3600 });
  };
  const results = await Promise.all([auth.ensureAccessToken(), auth.ensureAccessToken(), auth.ensureAccessToken()]);
  assert.deepEqual(results, ["NEW", "NEW", "NEW"]);
  assert.equal(calls, 1);
});

test("a stale lock left by a dead process does not block a refresh", async () => {
  auth.saveTokens({ access_token: "OLD", refresh_token: "R", expires_in: 10 });
  fs.writeFileSync(`${TOKEN_FILE}.lock`, JSON.stringify({ pid: 2147483646, started_at: new Date().toISOString() }));
  globalThis.fetch = async () => response(200, { access_token: "NEW", refresh_token: "R2", expires_in: 3600 });
  assert.equal(await auth.ensureAccessToken(), "NEW");
});

test("a failed refresh reports authentication_required with the re-login command", async () => {
  auth.saveTokens({ access_token: "OLD", refresh_token: "R", expires_in: 10 });
  globalThis.fetch = async () => response(400, { error: "invalid_grant" });
  await assert.rejects(() => auth.ensureAccessToken(), (error) => {
    assert.ok(error instanceof AuthError);
    assert.equal(error.exitCode, 3);
    assert.match(error.message, /kcal provider yazio login --email/);
    return true;
  });
});

test("version_blocked during the token exchange is api_changed, not a bad password", async () => {
  globalThis.fetch = async () => response(403, { error: "version_blocked" });
  await assert.rejects(() => auth.exchangePassword("me@example.com", "x"), (error) => {
    assert.ok(error instanceof ApiChangedError);
    assert.equal(error.exitCode, 7);
    return true;
  });
});

test("no cached token is authentication_required, not a crash", async () => {
  await assert.rejects(() => auth.ensureAccessToken(), AuthError);
});

test("a token with no refresh token cannot be renewed silently", async () => {
  auth.saveTokens({ access_token: "A", expires_in: 10 });
  globalThis.fetch = async () => { throw new Error("must not attempt an exchange"); };
  await assert.rejects(() => auth.ensureAccessToken(), /no refresh token/);
});

test("the password never reaches the token file or a thrown error", async () => {
  globalThis.fetch = async () => response(401, { error: "invalid_credentials", error_description: "bad login" });
  await assert.rejects(() => auth.exchangePassword("me@example.com", "correct-horse-battery"), (error) => {
    assert.ok(!JSON.stringify(error.details ?? {}).includes("correct-horse-battery"));
    assert.ok(!error.message.includes("correct-horse-battery"));
    return true;
  });
  globalThis.fetch = async () => response(200, { access_token: "A", refresh_token: "R", expires_in: 3600 });
  await auth.exchangePassword("me@example.com", "correct-horse-battery").then(auth.saveTokens);
  assert.ok(!fs.readFileSync(TOKEN_FILE, "utf8").includes("correct-horse-battery"));
});

test("logout removes the token file and its lock", () => {
  auth.saveTokens({ access_token: "A", refresh_token: "R", expires_in: 3600 });
  fs.writeFileSync(`${TOKEN_FILE}.lock`, "{}");
  auth.deleteTokens();
  assert.equal(auth.loadTokens(), null);
  assert.ok(!fs.existsSync(`${TOKEN_FILE}.lock`));
});

test("a corrupt token file reads as no token rather than throwing", () => {
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, "{not json");
  assert.equal(auth.loadTokens(), null);
});

test("backspace in the hidden prompt deletes a whole UTF-8 character", () => {
  const bytes = [...Buffer.from("парольX", "utf8")];
  assert.equal(Buffer.from(_internals.dropLastChar(bytes)).toString("utf8"), "пароль");
  assert.equal(Buffer.from(_internals.dropLastChar([...Buffer.from("пароль", "utf8")])).toString("utf8"), "парол");
  assert.deepEqual(_internals.dropLastChar([]), []);
});
