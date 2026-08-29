// Declarative registry of every YAZIO operation this CLI is allowed to perform.
//
// `replaySafe` is the load-bearing field: it distinguishes a request that may be retried
// after a network failure from one that may not. GETs default to safe. A diary write is
// never safe to replay blindly — a second POST after an uncertain first one is how you end
// up eating dinner twice on paper — so those recover by reading the day back instead.
//
// `destructive` marks operations that require an explicit --yes at the command layer.
const e = (method, path, extra = {}) => ({
  method,
  path,
  auth: true,
  replaySafe: method === "GET",
  destructive: false,
  ...extra,
});

export const ENDPOINTS = {
  // Authentication. The only operation that works without an accepted app User-Agent,
  // and the only one that does not carry a bearer token.
  "auth.token": e("POST", "/v22/oauth/token", { auth: false, replaySafe: false }),

  "user.get": e("GET", "/v22/user"),

  // `sex` and `countries` are mandatory: blank answers 400 "This value should not be blank".
  // `query` takes free text or an EAN barcode — there is no separate barcode endpoint.
  "products.search": e("GET", "/v22/products/search"),
  // The response body carries no id of its own; callers fold the requested one back in.
  "products.get": e("GET", "/v22/products/{id}"),
  "products.suggested": e("GET", "/v22/user/products/suggested"),

  "diary.day": e("GET", "/v22/user/consumed-items"),
  "diary.add": e("POST", "/v22/user/consumed-items", { replaySafe: false }),
  "diary.delete": e("DELETE", "/v22/user/consumed-items", { replaySafe: false, destructive: true }),
  // A range endpoint, not a single-day one.
  "diary.nutrients-daily": e("GET", "/v22/user/consumed-items/nutrients-daily"),
  // Per-meal detail and goals. Reports no day total — callers sum the four meal slots.
  "diary.daily-summary": e("GET", "/v22/user/widgets/daily-summary"),
};

export function endpoint(name) {
  return ENDPOINTS[name] || null;
}

export function expandPath(template, params = {}) {
  return template.replace(/\{([^}]+)\}/g, (_, key) => {
    if (params[key] === undefined || params[key] === null || params[key] === "") {
      throw new Error(`missing path parameter: ${key}`);
    }
    return encodeURIComponent(String(params[key]));
  });
}
