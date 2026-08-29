import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "yazio-params-"));
process.env.YAZIO_TOKEN_FILE = path.join(tmp, "token.json");
process.env.YAZIO_API_URL = "https://api.test";

const { saveTokens } = await import("../src/auth.mjs");
const { DAYTIMES, requireDaytime, searchRegion } = await import("../src/params.mjs");
const { UsageError } = await import("../src/errors.mjs");

afterEach(() => fs.rmSync(process.env.YAZIO_TOKEN_FILE, { force: true }));

function withProfile(user) {
  saveTokens({ access_token: "A", refresh_token: "R", expires_in: 3600 }, { user });
}

test("the food-database country wins over the account country", async () => {
  // YAZIO keeps these apart because someone living abroad may still want their home database.
  withProfile({ sex: "male", country: "DE", food_database_country: "NL", language: "ru" });
  const region = await searchRegion();
  assert.equal(region.countries, "NL");
});

test("the account country is used when no food-database country is set", async () => {
  withProfile({ sex: "female", country: "kz", food_database_country: null, language: "ru" });
  const region = await searchRegion();
  assert.equal(region.countries, "KZ", "the API wants an upper-case ISO code");
  assert.equal(region.sex, "female");
});

test("locales rank the profile language first, English second", async () => {
  withProfile({ sex: "male", country: "NL", food_database_country: "NL", language: "ru" });
  assert.equal((await searchRegion()).locales, "ru_NL,en_NL");
});

test("an English profile does not ask for the same locale twice", async () => {
  withProfile({ sex: "male", country: "NL", food_database_country: "NL", language: "en" });
  assert.equal((await searchRegion()).locales, "en_NL");
});

test("explicit flags override the profile", async () => {
  withProfile({ sex: "male", country: "NL", food_database_country: "NL", language: "en" });
  const region = await searchRegion({ countries: "gb", locales: "en_GB" });
  assert.equal(region.countries, "GB");
  assert.equal(region.locales, "en_GB");
});

test("a sex the API does not know falls back rather than getting the search rejected", async () => {
  // The search parameter only takes male/female; sending anything else fails the whole call.
  withProfile({ sex: "other", country: "NL", food_database_country: "NL", language: "en" });
  assert.equal((await searchRegion()).sex, "male");
});

test("a profile without a country still produces a searchable region", async () => {
  withProfile({ sex: "male", country: null, food_database_country: null, language: "en" });
  const region = await searchRegion();
  assert.ok(region.countries, "search refuses a blank country outright");
  assert.ok(region.sex, "search refuses a blank sex outright");
});

test("the four meal slots are the only ones accepted", () => {
  assert.deepEqual(DAYTIMES, ["breakfast", "lunch", "dinner", "snack"]);
  assert.equal(requireDaytime("Breakfast"), "breakfast");
  assert.equal(requireDaytime(" dinner "), "dinner");
});

test("an unknown meal is rejected here, because the API accepts it silently", () => {
  // YAZIO takes an unrecognised daytime without complaint and then files the entry where the
  // user will never find it, so this is the only place it can be caught.
  assert.throws(() => requireDaytime("brunch"), UsageError);
  assert.throws(() => requireDaytime("завтрак"), UsageError);
  assert.throws(() => requireDaytime(undefined), UsageError);
  assert.throws(() => requireDaytime(true), UsageError);
});
