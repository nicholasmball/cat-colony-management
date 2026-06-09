import { test } from "node:test";
import assert from "node:assert/strict";
import { channelsFor } from "./alert-routing.ts";

test("urgent routes to push + sms", () => {
  assert.deepEqual(channelsFor("urgent"), ["push", "sms"]);
});

test("routine routes to in_app + email", () => {
  assert.deepEqual(channelsFor("routine"), ["in_app", "email"]);
});

test("returns a fresh array each call (no shared mutable constant)", () => {
  const a = channelsFor("urgent");
  const b = channelsFor("urgent");
  assert.notEqual(a, b, "should not be the same array reference");
  a.push("in_app");
  assert.deepEqual(channelsFor("urgent"), ["push", "sms"], "mutation leaked");
});
