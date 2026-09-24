import fs from "node:fs";
import path from "node:path";
import { API_URL, CLIENT_ID, CLIENT_SECRET, TIMEOUT_MS, TOKEN_FILE, defaultHeaders } from "./config.mjs";
import { ApiChangedError, ApiError, AuthError } from "./errors.mjs";
import { sleep } from "./util.mjs";

const TOKEN_PATH = "/v22/oauth/token";
export const RELOGIN_HINT = "run: kcal provider yazio login --email <address>";

// The token exchange is the one call that does not go through client.mjs: it cannot, since
// client.mjs asks *this* module for a token. It is also the one endpoint the API serves
// without checking the app version, so a `version_blocked` here would mean something else
// entirely and is surfaced as such.
async function tokenPost(body) {
  const url = new URL(TOKEN_PATH, API_URL);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("request timeout")), TIMEOUT_MS);
  let res;
  let text;
  try {
    res = await fetch(url, {
      method: "POST",
      // v22 takes a JSON body here. Older community documentation describes
      // application/x-www-form-urlencoded; that was v15 and it is not what this API wants.
      headers: { ...defaultHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    text = await res.text();
  } finally {
    clearTimeout(timer);
  }
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  return { res, payload, text };
}

function describeTokenFailure(res, payload, text) {
  // A rejected grant comes back as 400 with an empty text/html body — no error code, no
  // description, and identical whether the address is unknown or the password is wrong. The
  // endpoint is otherwise talkative (a blank field or a bad client answers with a JSON
  // validation list), so an empty 400 is specifically "these credentials were not accepted"
  // and saying "HTTP 400" instead would send the reader looking for a malformed request.
  if (res.status === 400 && !payload && !text?.trim()) {
    return new AuthError("YAZIO did not accept this email and password", {
      hint: "check the address, and note that an account created with Sign in with Apple or Google "
        + "has no password until one is set in the YAZIO app",
    });
  }
  const reason = payload?.error_description || payload?.error || text?.slice(0, 200) || `HTTP ${res.status}`;
  if (payload?.error === "version_blocked") {
    return new ApiChangedError(`YAZIO blocked this client version during the token exchange: ${reason}`, {
      user_agent: defaultHeaders()["User-Agent"],
      hint: "set YAZIO_USER_AGENT to a current YAZIO app User-Agent",
    });
  }
  return new AuthError(`YAZIO rejected the sign-in: ${reason}`, { status: res.status });
}

export async function exchangePassword(username, password) {
  const { res, payload, text } = await tokenPost({
    username, password, grant_type: "password", client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
  });
  if (!res.ok || !payload?.access_token) throw describeTokenFailure(res, payload, text);
  return payload;
}

export async function exchangeRefreshToken(refreshToken) {
  const { res, payload, text } = await tokenPost({
    refresh_token: refreshToken, grant_type: "refresh_token", client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
  });
  if (!res.ok || !payload?.access_token) throw describeTokenFailure(res, payload, text);
  return payload;
}

export function saveTokens(tokens, extra = {}) {
  if (!tokens?.access_token) throw new AuthError("token response did not contain access_token");
  const dir = path.dirname(TOKEN_FILE);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch {}
  const now = Date.now();
  // `expires_in` has been observed at ~3600 on the live API; an older community document
  // shows 172800. Trust whatever arrives and only fall back when nothing does.
  const lifetime = Number(tokens.expires_in);
  const payload = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || extra.refresh_token || null,
    token_type: tokens.token_type || "Bearer",
    // `extra.expires_at` is for rewrites that are not a fresh exchange (caching the profile
    // beside the token). Recomputing the expiry there would silently reset the token's
    // lifetime to the fallback hour.
    expires_at: extra.expires_at
      || new Date(now + (Number.isFinite(lifetime) && lifetime > 0 ? lifetime : 3600) * 1000).toISOString(),
    obtained_at: extra.obtained_at || new Date(now).toISOString(),
    ...(extra.user !== undefined ? { user: extra.user } : {}),
  };
  const temp = `${TOKEN_FILE}.${process.pid}.${Date.now()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temp, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify(payload, null, 2));
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(temp, TOKEN_FILE);
  } catch (error) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
    fs.rmSync(temp, { force: true });
    throw error;
  }
  return payload;
}

export function loadTokens() {
  try {
    const data = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
    return data?.access_token ? data : null;
  } catch { return null; }
}

export function deleteTokens() {
  fs.rmSync(TOKEN_FILE, { force: true });
  fs.rmSync(`${TOKEN_FILE}.lock`, { force: true });
}

export function tokenFilePath() { return TOKEN_FILE; }

export function isExpiring(tokens, skewSeconds = 60) {
  return !tokens?.expires_at || Date.parse(tokens.expires_at) <= Date.now() + skewSeconds * 1000;
}

// The cached profile answers the `sex` and `countries` that product search refuses to run
// without, so it is kept beside the token rather than re-fetched on every search.
export function loadProfile() { return loadTokens()?.user || null; }

export function saveProfile(user) {
  const cached = loadTokens();
  if (!cached) throw new AuthError(`no cached token — ${RELOGIN_HINT}`);
  return saveTokens(
    { access_token: cached.access_token, refresh_token: cached.refresh_token, token_type: cached.token_type },
    { user, expires_at: cached.expires_at, obtained_at: cached.obtained_at },
  );
}

async function acquireTokenLock(timeoutMs = 10000) {
  const lockFile = `${TOKEN_FILE}.lock`;
  fs.mkdirSync(path.dirname(lockFile), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + timeoutMs;
  while (true) {
    let fd;
    try {
      fd = fs.openSync(lockFile, "wx", 0o600);
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
      return () => { try { fs.closeSync(fd); } catch {} fs.rmSync(lockFile, { force: true }); };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      // A lock left behind by a process that died is not a lock. Anything else waits.
      let stale = false;
      try {
        const owner = JSON.parse(fs.readFileSync(lockFile, "utf8"));
        if (Number.isInteger(owner.pid) && owner.pid > 0) {
          try { process.kill(owner.pid, 0); } catch (killError) { stale = killError.code === "ESRCH"; }
        }
      } catch { stale = true; }
      if (stale) { fs.rmSync(lockFile, { force: true }); continue; }
      if (Date.now() >= deadline) throw new AuthError("timed out waiting for the token refresh lock");
      await sleep(100);
    }
  }
}

let refreshPromise = null;

export async function refreshTokens({ force = true, expectedAccessToken = null } = {}) {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const release = await acquireTokenLock();
    try {
      // Re-read after taking the lock: another process may have refreshed while we waited,
      // in which case there is nothing to do and one fewer password-less exchange to risk.
      const cached = loadTokens();
      if (!cached) throw new AuthError(`no cached token — ${RELOGIN_HINT}`);
      if (!cached.refresh_token) throw new AuthError(`no refresh token stored — ${RELOGIN_HINT}`);
      if (expectedAccessToken && cached.access_token !== expectedAccessToken && !isExpiring(cached)) return cached;
      if (!force && !isExpiring(cached)) return cached;
      let fresh;
      try {
        fresh = await exchangeRefreshToken(cached.refresh_token);
      } catch (error) {
        if (error instanceof ApiChangedError) throw error;
        // No reference implementation of this API exercises the refresh grant, so a failure
        // here is a plausible outcome rather than a surprise. There is no stored password to
        // fall back on by design, so the only honest recovery is to say so.
        throw new AuthError(`token refresh failed (${error.message}) — ${RELOGIN_HINT}`, {
          retry_command: "kcal provider yazio login --email <address>",
        });
      }
      return saveTokens(fresh, { refresh_token: cached.refresh_token, user: cached.user });
    } finally {
      release();
    }
  })();
  try { return await refreshPromise; } finally { refreshPromise = null; }
}

export async function ensureAccessToken({ forceRefresh = false } = {}) {
  const cached = loadTokens();
  if (!cached) throw new AuthError(`no cached token — ${RELOGIN_HINT}`);
  if (forceRefresh || isExpiring(cached)) {
    return (await refreshTokens({ force: forceRefresh, expectedAccessToken: cached.access_token })).access_token;
  }
  return cached.access_token;
}

export { ApiError };
