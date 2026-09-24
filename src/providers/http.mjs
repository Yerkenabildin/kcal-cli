import { ApiError } from "../errors.mjs";
import { KCAL_TIMEOUT_MS } from "../config.mjs";

export async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("request timeout")), options.timeoutMs || KCAL_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    if (!response.ok) {
      throw new ApiError(`HTTP ${response.status} from ${new URL(url).host}`, response.status, payload || { body: text.slice(0, 500) });
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}
