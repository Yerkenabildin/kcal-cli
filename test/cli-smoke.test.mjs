import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "yazio.mjs");

async function cli(args) {
  try {
    const { stdout, stderr } = await run(process.execPath, [BIN, ...args]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

test("help goes to stdout and exits 0", async () => {
  const { code, stdout, stderr } = await cli(["--help"]);
  assert.equal(code, 0);
  assert.match(stdout, /Usage:\s+yazio <command>/);
  assert.equal(stderr, "");
});

test("bare invocation prints help rather than failing", async () => {
  const { code, stdout } = await cli([]);
  assert.equal(code, 0);
  assert.match(stdout, /yazio <command>/);
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
  const { code, stderr } = await cli(["login", "--email", "me@example.com", "--password", "hunter2"]);
  assert.equal(code, 2);
  const payload = JSON.parse(stderr);
  assert.equal(payload.error, "usage_error");
  assert.match(payload.message, /visible in `ps`/);
  assert.ok(!stderr.includes("hunter2"), "the rejected password must not be echoed back");
});

test("login without a terminal fails with usage guidance, not a hang", async () => {
  const { code, stderr } = await cli(["login", "--email", "me@example.com"]);
  assert.equal(code, 2);
  assert.match(JSON.parse(stderr).message, /interactive terminal/);
});

test("login requires an email that looks like one", async () => {
  const { code, stderr } = await cli(["login", "--email", "not-an-email"]);
  assert.equal(code, 2);
  assert.match(JSON.parse(stderr).message, /must be an email address/);
});

test("an unknown flag on a known command names the flags that exist", async () => {
  const { code, stderr } = await cli(["logout", "--force"]);
  assert.equal(code, 2);
  assert.match(JSON.parse(stderr).message, /unknown flag for "logout": --force/);
});
