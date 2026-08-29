import { COUNTRIES, LOCALES } from "./config.mjs";
import { loadProfile } from "./auth.mjs";
import { AuthError, UsageError } from "./errors.mjs";
import { invoke } from "./commands/_shared.mjs";

const FALLBACK_SEX = "male";
const FALLBACK_COUNTRY = "NL";

// `sex` and `countries` are mandatory on /v22/products/search — blank answers
// 400 "This value should not be blank" — but neither is something a caller should have to
// think about, so they come from the authenticated profile. Taking them from there also keeps
// results ranked the way the app would rank them.
export async function searchRegion({ countries, locales } = {}) {
  let profile = loadProfile();
  if (!profile) {
    // Only reached if the profile was not cached at login, e.g. the account existed before
    // this CLI started caching it. One fetch, then it lives beside the token.
    profile = summarise(await invoke("user.get"));
  }

  const country = String(countries || COUNTRIES || profile?.food_database_country || profile?.country || FALLBACK_COUNTRY)
    .trim().toUpperCase();
  if (!country) throw new UsageError("a search needs a country; pass --countries NL");

  const sex = String(profile?.sex || FALLBACK_SEX).trim().toLowerCase();
  // The API takes male/female here. Anything else is not a value it knows, and sending it
  // gets the search rejected rather than answered differently, so it falls back.
  const searchSex = sex === "male" || sex === "female" ? sex : FALLBACK_SEX;

  const language = String(profile?.language || "en").trim().toLowerCase();
  // Underscore form, comma-separated: a ranking hint, not a filter. The user's own language
  // first, English second, both against the country whose database is being searched.
  const primary = country.split(",")[0];
  // Deduplicated: for an English-speaking profile the two entries would otherwise be the same
  // locale twice, which is noise in the request and in anything that reads it back.
  const ranked = [...new Set([`${language}_${primary}`, `en_${primary}`])];
  const searchLocales = locales || LOCALES || ranked.join(",");

  return { sex: searchSex, countries: country, locales: searchLocales };
}

function summarise(profile) {
  return {
    sex: profile?.sex ?? null,
    country: profile?.country ?? null,
    food_database_country: profile?.food_database_country ?? null,
    language: profile?.language ?? null,
  };
}

// YAZIO buckets consumed items into exactly these four slots. It accepts an unrecognised
// `daytime` without complaint and then files the entry where the user will never find it, so
// this is checked here rather than left to the API.
export const DAYTIMES = ["breakfast", "lunch", "dinner", "snack"];

export function requireDaytime(value, label = "--meal") {
  if (value === undefined || value === true) {
    throw new UsageError(`${label} is required: one of ${DAYTIMES.join(", ")}`);
  }
  const normalised = String(value).trim().toLowerCase();
  if (!DAYTIMES.includes(normalised)) {
    throw new UsageError(`${label} must be one of ${DAYTIMES.join(", ")}; got: ${value}`);
  }
  return normalised;
}

export { AuthError };
