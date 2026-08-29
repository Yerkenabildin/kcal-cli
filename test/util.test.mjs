import { test } from "node:test";
import assert from "node:assert/strict";
import { UsageError } from "../src/errors.mjs";
import {
  dateOfTimestamp, entryTimestamp, localDate, parseArgs, round, roundDeep,
  stableStringify, toDateString, toNumber, toTimestamp,
} from "../src/util.mjs";

test("parseArgs splits positionals, --k v, --k=v and bare flags", () => {
  const { positionals, flags } = parseArgs(["add", "ID", "--meal", "dinner", "--amount=250", "--yes"]);
  assert.deepEqual(positionals, ["add", "ID"]);
  assert.deepEqual(flags, { meal: "dinner", amount: "250", yes: true });
});

test("a negative number is a flag value, not a new flag", () => {
  const { flags } = parseArgs(["--offset", "-3"]);
  assert.equal(flags.offset, "-3");
});

test("toDateString accepts YYYY-MM-DD and rejects anything else", () => {
  assert.equal(toDateString("2026-08-29"), "2026-08-29");
  assert.throws(() => toDateString("29.08.2026"), UsageError);
  assert.throws(() => toDateString("2026-08-29T10:00:00"), UsageError);
  assert.throws(() => toDateString("2026-13-01"), UsageError);
  assert.throws(() => toDateString(true), UsageError);
});

test("toDateString defaults to today in local time, not UTC", () => {
  assert.equal(toDateString(undefined), localDate(new Date()));
});

test("entryTimestamp stamps today with the real time and other days with midday", () => {
  const now = new Date(2026, 7, 29, 19, 40, 12);
  assert.equal(entryTimestamp("2026-08-29", now), "2026-08-29 19:40:12");
  assert.equal(entryTimestamp("2026-08-28", now), "2026-08-28 12:00:00");
});

test("the write timestamp is space-separated, not ISO-T", () => {
  const stamp = entryTimestamp("2026-08-29", new Date(2026, 7, 29, 9, 5, 3));
  assert.equal(stamp, "2026-08-29 09:05:03");
  assert.ok(!stamp.includes("T"), "YAZIO rejects an ISO-T stamp on a consumed item");
});

test("toTimestamp validates the exact write format", () => {
  assert.equal(toTimestamp("2026-08-29 19:40:12"), "2026-08-29 19:40:12");
  assert.throws(() => toTimestamp("2026-08-29T19:40:12"), UsageError);
  assert.throws(() => toTimestamp("2026-08-29"), UsageError);
});

test("dateOfTimestamp reduces a write stamp back to the day it reads under", () => {
  assert.equal(dateOfTimestamp("2026-08-29 19:40:12"), "2026-08-29");
  assert.equal(dateOfTimestamp("2026-08-29"), "2026-08-29");
  assert.equal(dateOfTimestamp("nonsense"), null);
});

test("toNumber enforces a strictly positive amount", () => {
  assert.equal(toNumber("250", "--amount", { exclusiveMin: 0 }), 250);
  assert.equal(toNumber("0.5", "--amount", { exclusiveMin: 0 }), 0.5);
  assert.throws(() => toNumber("0", "--amount", { exclusiveMin: 0 }), UsageError);
  assert.throws(() => toNumber("-5", "--amount", { exclusiveMin: 0 }), UsageError);
  assert.throws(() => toNumber("abc", "--amount"), UsageError);
});

test("round keeps a micronutrient visible instead of flattening it to zero", () => {
  assert.equal(round(2143.0000000000005), 2143);
  assert.equal(round(0.00012), 0.00012);
  assert.equal(round(0), 0);
});

test("roundDeep walks nested structures without touching non-numbers", () => {
  assert.deepEqual(
    roundDeep({ a: 1.005001, b: [2.0000001, "x"], c: null }),
    { a: 1.01, b: [2, "x"], c: null },
  );
});

test("stableStringify is key-order independent", () => {
  assert.equal(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }));
});

test("a piped password keeps everything but the one newline the file ends with", async () => {
  const { stripTrailingNewline } = await import("../src/commands/login.mjs");
  assert.equal(stripTrailingNewline("s3cret\n"), "s3cret");
  assert.equal(stripTrailingNewline("s3cret\r\n"), "s3cret");
  assert.equal(stripTrailingNewline("s3cret"), "s3cret");
  // A password may legitimately end in a space, or contain newlines of its own.
  assert.equal(stripTrailingNewline("s3cret \n"), "s3cret ");
  assert.equal(stripTrailingNewline("two\nlines\n"), "two\nlines");
  assert.equal(stripTrailingNewline("s3cret\n\n"), "s3cret\n");
});
