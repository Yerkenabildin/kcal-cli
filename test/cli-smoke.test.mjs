import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "yazio.mjs");

// stdin is always closed explicitly. A command that reads it (--password-stdin) would
// otherwise wait for an EOF that a pipe held open by the test never sends.
async function cli(args, stdin = "") {
  const pending = run(process.execPath, [BIN, ...args]);
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

test("--password-stdin with nothing on stdin fails loudly rather than sending an empty password", async () => {
  const { code, stderr } = await cli(["login", "--email", "me@example.com", "--password-stdin"], "");
  assert.equal(code, 2);
  assert.match(JSON.parse(stderr).message, /no password provided/);
});
