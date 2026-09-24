import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";

const run = promisify(execFile);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(ROOT, "bin", "kcal.mjs");
const ALIAS = path.join(ROOT, "bin", "yazio.mjs");
process.env.KCAL_DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kcal-cli-")), "kcal.sqlite3");

// stdin is always closed explicitly. A command that reads it (--password-stdin) would
// otherwise wait for an EOF that a pipe held open by the test never sends.
async function cli(args, stdin = "", env = {}) {
  const pending = run(process.execPath, [BIN, ...args], { env: { ...process.env, ...env } });
  pending.child.stdin.end(stdin);
  try {
    const { stdout, stderr } = await pending;
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

test("help goes to stdout and exits 0", async () => {
  const { code, stdout, stderr } = await cli(["--help"]);
  assert.equal(code, 0);
  assert.match(stdout, /Usage:\s+kcal <command>/);
  assert.equal(stderr, "");
});

test("bare invocation prints help rather than failing", async () => {
  const { code, stdout } = await cli([]);
  assert.equal(code, 0);
  assert.match(stdout, /kcal <command>/);
});

test("unknown command exits 2 with JSON on stderr and nothing on stdout", async () => {
  const { code, stdout, stderr } = await cli(["definitely-not-a-command"]);
  assert.equal(code, 2);
  assert.equal(stdout, "");
  const payload = JSON.parse(stderr);
  assert.equal(payload.error, "usage_error");
  assert.match(payload.message, /unknown command/);
});

test("stderr stays parseable JSON, one document", async () => {
  const { stderr } = await cli(["nope"]);
  assert.doesNotThrow(() => JSON.parse(stderr));
});

test("--password is refused: argv is visible in ps", async () => {
  const { code, stderr } = await cli(["provider", "yazio", "login", "--email", "me@example.com", "--password", "hunter2"]);
  assert.equal(code, 2);
  const payload = JSON.parse(stderr);
  assert.equal(payload.error, "usage_error");
  assert.match(payload.message, /visible in `ps`/);
  assert.ok(!stderr.includes("hunter2"), "the rejected password must not be echoed back");
});

test("login without a terminal fails with usage guidance, not a hang", async () => {
  const { code, stderr } = await cli(["provider", "yazio", "login", "--email", "me@example.com"]);
  assert.equal(code, 2);
  assert.match(JSON.parse(stderr).message, /interactive terminal/);
});

test("login requires an email that looks like one", async () => {
  const { code, stderr } = await cli(["provider", "yazio", "login", "--email", "not-an-email"]);
  assert.equal(code, 2);
  assert.match(JSON.parse(stderr).message, /must be an email address/);
});

test("an unknown flag on a known command names the flags that exist", async () => {
  const { code, stderr } = await cli(["favorite", "list", "--force"]);
  assert.equal(code, 2);
  assert.match(JSON.parse(stderr).message, /unknown flag for "favorite": --force/);
});

test("--password-stdin with nothing on stdin fails loudly rather than sending an empty password", async () => {
  const { code, stderr } = await cli(["provider", "yazio", "login", "--email", "me@example.com", "--password-stdin"], "");
  assert.equal(code, 2);
  assert.match(JSON.parse(stderr).message, /no password provided/);
});

test("the deprecated yazio binary is an alias of kcal", async () => {
  const pending = run(process.execPath, [ALIAS, "--help"]);
  pending.child.stdin.end("");
  const { stdout, stderr } = await pending;
  assert.match(stdout, /Usage:\s+kcal <command>/);
  assert.equal(stderr, "");
});

test("read-only local commands do not create a missing database", async () => {
  const cases = [
    { args: ["diary", "day", "2026-09-24"], check: (payload) => assert.equal(payload.entry_count, 0) },
    { args: ["favorite", "list"], check: (payload) => assert.deepEqual(payload.items, []) },
    { args: ["goal", "show"], check: (payload) => assert.equal(payload.goals, null) },
  ];
  for (const scenario of cases) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kcal-read-only-"));
    const dbFile = path.join(dir, "missing.sqlite3");
    const { code, stdout, stderr } = await cli(scenario.args, "", { KCAL_DB_FILE: dbFile });
    assert.equal(code, 0, stderr);
    assert.equal(stderr, "");
    scenario.check(JSON.parse(stdout));
    assert.equal(fs.existsSync(dbFile), false, `${scenario.args.join(" ")} created SQLite`);
  }
});

test("missing item and recipe reads fail without creating a database", async () => {
  for (const args of [
    ["item", "show", "l::00000000-0000-4000-8000-000000000000"],
    ["recipe", "show", "r::00000000-0000-4000-8000-000000000000"],
  ]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kcal-read-error-"));
    const dbFile = path.join(dir, "missing.sqlite3");
    const { code, stdout, stderr } = await cli(args, "", { KCAL_DB_FILE: dbFile });
    assert.equal(code, 2);
    assert.equal(stdout, "");
    assert.equal(JSON.parse(stderr).error, "usage_error");
    assert.equal(fs.existsSync(dbFile), false, `${args.join(" ")} created SQLite`);
  }
});

test("food create, exact-alias diary add, and diary day work end to end", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kcal-acceptance-"));
  const dbFile = path.join(dir, "kcal.sqlite3");
  const env = { KCAL_DB_FILE: dbFile };
  const product = {
    schema_version: 1,
    kind: "food",
    name: "Red lentils",
    aliases: ["my lentils"],
    brand: null,
    barcodes: [],
    state: "dry",
    basis: { amount: 100, unit: "g" },
    nutrients: { energy_kcal: 350, protein_g: 25, fat_g: 2, carb_g: 55, fiber_g: 11 },
    portions: [],
    category: "legumes",
    tags: [],
  };
  const created = await cli(["food", "create", "--file", "-"], JSON.stringify(product), env);
  assert.equal(created.code, 0, created.stderr);
  const itemId = JSON.parse(created.stdout).item.id;

  const added = await cli([
    "diary", "add", "my lentils", "--amount", "200", "--unit", "g",
    "--meal", "lunch", "--date", "2026-09-24",
  ], "", env);
  assert.equal(added.code, 0, added.stderr);
  assert.equal(JSON.parse(added.stdout).entry.item_id, itemId);
  assert.equal(JSON.parse(added.stdout).entry.nutrients.energy_kcal, 700);

  const day = await cli(["diary", "day", "2026-09-24"], "", env);
  assert.equal(day.code, 0, day.stderr);
  assert.equal(JSON.parse(day.stdout).totals.energy_kcal, 700);

  const saved = await cli(["item", "save", itemId], "", env);
  assert.equal(saved.code, 0, saved.stderr);
  assert.equal(JSON.parse(saved.stdout).changed, false);
});
