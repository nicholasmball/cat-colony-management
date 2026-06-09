import { test } from "node:test";
import assert from "node:assert/strict";
import { isUuid } from "./uuid.ts";

test("isUuid: accepts a crypto.randomUUID()-shaped v4", () => {
  assert.equal(isUuid("3f50b9c2-1a8e-4c7d-9b2a-0e1f2a3b4c5d"), true);
});

test("isUuid: accepts uppercase and mixed case", () => {
  assert.equal(isUuid("3F50B9C2-1A8E-4C7D-9B2A-0E1F2A3B4C5D"), true);
  assert.equal(isUuid("3f50B9c2-1a8E-4c7D-9b2A-0e1F2a3B4c5D"), true);
});

test("isUuid: rejects the obvious non-UUIDs", () => {
  assert.equal(isUuid(""), false);
  assert.equal(isUuid("not-a-uuid"), false);
  // Missing a group / wrong lengths.
  assert.equal(isUuid("3f50b9c2-1a8e-4c7d-9b2a"), false);
  assert.equal(isUuid("3f50b9c2-1a8e-4c7d-9b2a-0e1f2a3b4c5"), false);
  // A non-hex character.
  assert.equal(isUuid("zf50b9c2-1a8e-4c7d-9b2a-0e1f2a3b4c5d"), false);
  // No dashes.
  assert.equal(isUuid("3f50b9c21a8e4c7d9b2a0e1f2a3b4c5d"), false);
});

test("isUuid: rejects non-strings", () => {
  assert.equal(isUuid(undefined), false);
  assert.equal(isUuid(null), false);
  assert.equal(isUuid(123), false);
  assert.equal(isUuid({}), false);
});
