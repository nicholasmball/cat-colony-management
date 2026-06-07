import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldBlockSubmit } from "./confirm.ts";

test("shouldBlockSubmit blocks only on explicit cancel", () => {
  assert.equal(shouldBlockSubmit(false), true);
});

test("shouldBlockSubmit allows an explicit confirm", () => {
  assert.equal(shouldBlockSubmit(true), false);
});

test("shouldBlockSubmit allows a suppressed/undefined dialog (the bug case)", () => {
  // window.confirm returns undefined when unavailable/suppressed in a PWA.
  assert.equal(shouldBlockSubmit(undefined), false);
});
