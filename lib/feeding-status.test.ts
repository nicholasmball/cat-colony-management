import { test } from "node:test";
import assert from "node:assert/strict";
import { feedingStatus, MISSED_AFTER_MIN } from "./feeding-status.ts";

test("fed always wins, regardless of the window", () => {
  assert.equal(feedingStatus({ fed: true, minutesAfterClose: null }), "fed");
  assert.equal(feedingStatus({ fed: true, minutesAfterClose: 5000 }), "fed");
});

test("unfed with no window is pending", () => {
  assert.equal(feedingStatus({ fed: false, minutesAfterClose: null }), "pending");
});

test("unfed before the threshold is pending", () => {
  assert.equal(feedingStatus({ fed: false, minutesAfterClose: 100 }), "pending");
});

test("unfed at 719 min (boundary) is still pending", () => {
  assert.equal(feedingStatus({ fed: false, minutesAfterClose: 719 }), "pending");
});

test("unfed at exactly 720 min (boundary) is missed", () => {
  assert.equal(feedingStatus({ fed: false, minutesAfterClose: 720 }), "missed");
  assert.equal(MISSED_AFTER_MIN, 720);
});

test("unfed well past the threshold is missed", () => {
  assert.equal(feedingStatus({ fed: false, minutesAfterClose: 800 }), "missed");
});
