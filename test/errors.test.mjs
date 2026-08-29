import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AmbiguousMatchError, ApiChangedError, AuthError, ConfirmationRequiredError,
  ConflictError, UsageError, WriteResultUnknownError, errorPayload, redact,
} from "../src/errors.mjs";

test("each error kind carries its documented exit code", () => {
  assert.equal(new UsageError("x").exitCode, 2);
  assert.equal(new AuthError("x").exitCode, 3);
  assert.equal(new ConfirmationRequiredError("x", "yazio y --yes").exitCode, 4);
  assert.equal(new AmbiguousMatchError("x").exitCode, 5);
  assert.equal(new ConflictError("x").exitCode, 5);
  assert.equal(new WriteResultUnknownError("x").exitCode, 6);
  assert.equal(new ApiChangedError("x").exitCode, 7);
});

test("confirmation error carries the exact retry command", () => {
  const payload = errorPayload(new ConfirmationRequiredError("needs --yes", "yazio diary remove ID --yes"));
  assert.equal(payload.error, "confirmation_required");
  assert.equal(payload.retry_command, "yazio diary remove ID --yes");
});

test("secret-looking keys are redacted out of an error payload", () => {
  const payload = errorPayload(new ApiChangedError("blocked", {
    request: { headers: { authorization: "Bearer sk-live-123", "user-agent": "YAZIO/26.30.1" } },
    access_token: "sk-live-123",
    password: "hunter2",
  }));
  const serialised = JSON.stringify(payload);
  assert.ok(!serialised.includes("sk-live-123"), "token must not survive redaction");
  assert.ok(!serialised.includes("hunter2"), "password must not survive redaction");
  assert.ok(serialised.includes("YAZIO/26.30.1"), "non-secret diagnostics must survive");
});

test("a bearer token embedded in free text is redacted too", () => {
  const out = redact({ message: "sent Bearer abc.def-123 upstream" });
  assert.equal(out.message, "sent Bearer [redacted] upstream");
});
