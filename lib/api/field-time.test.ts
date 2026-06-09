import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFieldTimestamp } from "./field-time.ts";

// A fixed "server now" so the skew window is deterministic.
const NOW = Date.parse("2026-06-08T12:00:00.000Z");

test("parseFieldTimestamp: a valid ISO in the past is normalised and kept", () => {
  const iso = "2026-06-08T11:30:00.000Z";
  assert.equal(parseFieldTimestamp(iso, NOW), iso);
});

test("parseFieldTimestamp: a non-canonical-but-parseable ISO normalises to ISO", () => {
  // No milliseconds + offset → still parseable; we return canonical UTC ISO.
  assert.equal(
    parseFieldTimestamp("2026-06-08T10:00:00+01:00", NOW),
    "2026-06-08T09:00:00.000Z",
  );
});

test("parseFieldTimestamp: absent (undefined/null) → undefined (DB fallback)", () => {
  assert.equal(parseFieldTimestamp(undefined, NOW), undefined);
  assert.equal(parseFieldTimestamp(null, NOW), undefined);
});

test("parseFieldTimestamp: unparseable / wrong type → undefined (fallback)", () => {
  assert.equal(parseFieldTimestamp("not-a-date", NOW), undefined);
  assert.equal(parseFieldTimestamp("", NOW), undefined);
  assert.equal(parseFieldTimestamp(1717848000000, NOW), undefined); // number
  assert.equal(parseFieldTimestamp({}, NOW), undefined);
});

test("parseFieldTimestamp: small future skew (< 5 min) is tolerated", () => {
  const iso = new Date(NOW + 2 * 60 * 1000).toISOString();
  assert.equal(parseFieldTimestamp(iso, NOW), iso);
});

test("parseFieldTimestamp: far-future beyond the skew window → undefined (fallback)", () => {
  const iso = new Date(NOW + 10 * 60 * 1000).toISOString();
  assert.equal(parseFieldTimestamp(iso, NOW), undefined);
});
