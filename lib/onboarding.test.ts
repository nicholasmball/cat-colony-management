import { test } from "node:test";
import assert from "node:assert/strict";
import { firstRunStep } from "./onboarding.ts";

test("firstRunStep nudges to colony for a brand-new org", () => {
  assert.equal(firstRunStep({ colonies: 0, cats: 0 }), "colony");
});

test("firstRunStep nudges to cat once a colony exists but no cats", () => {
  assert.equal(firstRunStep({ colonies: 1, cats: 0 }), "cat");
});

test("firstRunStep is done once colonies and cats exist", () => {
  assert.equal(firstRunStep({ colonies: 2, cats: 5 }), "done");
});

test("firstRunStep treats colonies as the gate even if cats somehow exist", () => {
  // Defensive: 0 colonies always means start with a colony.
  assert.equal(firstRunStep({ colonies: 0, cats: 3 }), "colony");
});
