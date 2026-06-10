import { test } from "node:test";
import assert from "node:assert/strict";
import { cronAuthorized } from "./cron-auth.ts";

test("accepts the exact Bearer secret", () => {
  assert.equal(cronAuthorized("s3cret", "Bearer s3cret"), true);
});

test("rejects a wrong / malformed header", () => {
  assert.equal(cronAuthorized("s3cret", "Bearer nope"), false);
  assert.equal(cronAuthorized("s3cret", "s3cret"), false);
  assert.equal(cronAuthorized("s3cret", null), false);
});

test("rejects when the secret is unset/empty (no empty-secret bypass)", () => {
  assert.equal(cronAuthorized(undefined, "Bearer "), false);
  assert.equal(cronAuthorized("", "Bearer "), false);
  assert.equal(cronAuthorized(undefined, null), false);
});
