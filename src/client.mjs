import { API_URL, RETRIES, TIMEOUT_MS, defaultHeaders } from "./config.mjs";
import { ensureAccessToken } from "./auth.mjs";
import { ApiChangedError, ApiError, AuthError, RateLimitError, UnsafeReplayError, UsageError } from "./errors.mjs";
import { sleep } from "./util.mjs";

// A rejected path is a caller problem (exit 2), not a runtime failure. Internal callers pass
// registry paths that always validate, so this only really fires for hand-written input —
// but it runs before the bearer token is attached, which is the point: no malformed or
// off-origin path can ever carry the token somewhere it does not belong.
function validatePath(apiPath) {
  if (typeof apiPath !== "string" || !apiPath.startsWith("/") || apiPath.startsWith("//") || /^https?:/i.test(apiPath)) {
    throw new UsageError("request path must be a relative API path starting with a single /");
  }
  if (apiPath.includes("\\")) throw new UsageError("backslashes are not allowed in API paths");
  if (apiPath.split("/").includes("..")) throw new UsageError("path traversal is not allowed");
  if (!/^\/v22(\/|$)/.test(apiPath)) throw new UsageError("request path must start with /v22/");
}

function buildUrl(apiPath) {
  validatePath(apiPath);
  const base = new URL(API_URL);
  const url = new URL(apiPath, base);
  if (url.origin !== base.origin) throw new UsageError("request path resolved outside the configured YAZIO origin");
  return url;
}

function addParams(search, values) {
  for (const [key, raw] of Object.entries(values || {})) {
    if (raw === undefined || raw === null) continue;
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      search.append(key, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
    }
  }
}

function retryAfter(headers) {
  const value = headers?.get?.("retry-after");
  return value && /^\d+$/.test(value) ? Number(value) : 60;
}

function retryableStatus(status) {
  return status === 429 || [502, 503, 504, 520, 521, 522].includes(status);
}

// The API answers 403 {"error":"version_blocked"} on every endpoint except the token exchange
// when it does not recognise the client version, which rides in the User-Agent. Reporting that
// as a generic 403 would send the reader looking for a permissions problem that does not exist,
// so it gets its own error kind and names the User-Agent actually in use.
function versionBlocked(payload) {
  return payload?.error === "version_blocked";
}

export async function request(apiPath, options = {}) {
  buildUrl(apiPath);
  const {
    method = "GET", query = {}, json, auth = true, raw = false,
    replaySafe = method === "GET", retries = RETRIES, signal,
  } = options;

  let token = auth ? await ensureAccessToken() : null;
  let refreshed = false;
  const maxAttempts = replaySafe ? Math.max(0, Number(retries)) + 1 : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const url = buildUrl(apiPath);
    addParams(url.searchParams, query);
    const headers = defaultHeaders();
    if (token) headers.Authorization = `Bearer ${token}`;
    let body;
    if (json !== undefined) {
      body = JSON.stringify(json);
      headers["Content-Type"] = "application/json";
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("request timeout")), TIMEOUT_MS);
    if (signal) signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });

    let res;
    try {
      res = await fetch(url, { method, headers, body, signal: controller.signal });
    } catch (error) {
      clearTimeout(timer);
      // A write that failed at the transport layer may or may not have reached the server.
      // Retrying is how you log dinner twice, so the caller is told the outcome is unknown
      // and recovers by reading the diary back instead.
      if (!replaySafe) {
        throw new UnsafeReplayError("unsafe request outcome is unknown; it was not replayed", {
          operation: apiPath, cause: error.message,
        });
      }
      if (attempt + 1 >= maxAttempts) throw error;
      await sleep(Math.min(1000 * (2 ** attempt), 30000));
      continue;
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }

    if (res.status === 403 && versionBlocked(payload)) {
      throw new ApiChangedError("YAZIO blocked this client version (version_blocked)", {
        operation: apiPath,
        user_agent: defaultHeaders()["User-Agent"],
        hint: "set YAZIO_USER_AGENT to a current YAZIO app User-Agent",
      });
    }

    if (res.status === 401) {
      if (!auth) throw new AuthError("unauthorized");
      if (!replaySafe) {
        throw new UnsafeReplayError("token was rejected during an unsafe operation; it was not replayed", {
          operation: apiPath,
        });
      }
      if (!refreshed) {
        token = await ensureAccessToken({ forceRefresh: true });
        refreshed = true;
        attempt--;
        continue;
      }
      throw new AuthError("token rejected after refresh — run: yazio login --email <address>");
    }

    if (res.status === 429 && (!replaySafe || attempt + 1 >= maxAttempts)) {
      throw new RateLimitError("YAZIO rate limit exceeded", retryAfter(res.headers));
    }
    if (retryableStatus(res.status) && replaySafe && attempt + 1 < maxAttempts) {
      await sleep(Math.min(retryAfter(res.headers), 30) * 1000);
      continue;
    }
    if (!res.ok) {
      throw new ApiError(payload?.error || `HTTP ${res.status} from YAZIO`, res.status, payload || { body: text.slice(0, 500) });
    }

    if (raw) {
      return { status: res.status, headers: Object.fromEntries(res.headers?.entries?.() || []), body: text, json: payload };
    }
    // Writes and deletes answer 204 with an empty body. That is the success case, not a
    // parse failure — every caller here verifies a write by reading the day back anyway.
    return payload;
  }
  throw new Error("request failed after retries");
}
