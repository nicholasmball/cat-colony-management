import { test } from "node:test";
import assert from "node:assert/strict";
import { passwordError } from "./password.ts";

test("too-short password → passwordTooShort", () => {
  assert.equal(passwordError("short", "short"), "passwordTooShort");
  assert.equal(passwordError("1234567", "1234567"), "passwordTooShort");
});

test("mismatch (both long enough) → passwordsDontMatch", () => {
  assert.equal(
    passwordError("longenough1", "different22"),
    "passwordsDontMatch",
  );
});

test("valid matching pair → null", () => {
  assert.equal(passwordError("longenough1", "longenough1"), null);
});

test("length is checked before match", () => {
  // Both too short AND mismatched → the length error wins (matches the flow).
  assert.equal(passwordError("ab", "cd"), "passwordTooShort");
});
