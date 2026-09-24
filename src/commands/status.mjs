// yazio status — what the stored credentials are actually good for.
//
// The states are kept apart deliberately: "no token", "expired but refreshable", "refresh is
// broken" and "the API has moved" all need different things from the user, and collapsing them
// into one "not authenticated" would hide which.
import { isExpiring, loadTokens, refreshTokens, tokenFilePath } from "../auth.mjs";
import { ApiChangedError, AuthError } from "../errors.mjs";
import { invoke } from "./_shared.mjs";
import { summariseProfile } from "./login.mjs";

export const knownFlags = new Set(["refresh"]);

const LOGIN_HINT = "kcal provider yazio login --email <address>";

export async function run(_positionals, flags) {
  const base = { ok: true, operation: "status", token_file: tokenFilePath() };
  const cached = loadTokens();
  if (!cached) {
    return { ...base, authenticated: false, state: "no_token", hint: LOGIN_HINT };
  }

  const expiry = {
    expires_at: cached.expires_at ?? null,
    expired: isExpiring(cached, 0),
    refresh_token_stored: Boolean(cached.refresh_token),
  };

  if (flags.refresh || isExpiring(cached)) {
    try {
      await refreshTokens({ force: Boolean(flags.refresh) });
    } catch (error) {
      if (error instanceof ApiChangedError) {
        return { ...base, authenticated: false, state: "api_changed", ...expiry, detail: error.message, hint: error.details?.hint ?? null };
      }
      if (error instanceof AuthError) {
        return { ...base, authenticated: false, state: "refresh_failed", ...expiry, detail: error.message, hint: LOGIN_HINT };
      }
      throw error;
    }
  }

  let profile;
  try {
    profile = await invoke("user.get");
  } catch (error) {
    if (error instanceof ApiChangedError) {
      return { ...base, authenticated: false, state: "api_changed", ...expiry, detail: error.message, hint: error.details?.hint ?? null };
    }
    if (error instanceof AuthError) {
      return { ...base, authenticated: false, state: "token_rejected", ...expiry, detail: error.message, hint: LOGIN_HINT };
    }
    throw error;
  }

  const fresh = loadTokens();
  return {
    ...base,
    authenticated: true,
    state: "authenticated",
    expires_at: fresh?.expires_at ?? null,
    expired: false,
    refresh_token_stored: Boolean(fresh?.refresh_token),
    profile: summariseProfile(profile),
  };
}
