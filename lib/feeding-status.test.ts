import { test } from "node:test";
import assert from "node:assert/strict";
import {
  feedingStatus,
  latestFedByColony,
  MISSED_AFTER_MIN,
} from "./feeding-status.ts";

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

test("latestFedByColony: a later Not-fed overrides an earlier Fed (the bug)", () => {
  const m = latestFedByColony([
    { colony_id: "a", observed_at: "2026-06-07T16:46:00Z", fed: true },
    { colony_id: "a", observed_at: "2026-06-07T17:10:00Z", fed: false },
  ]);
  assert.equal(m.get("a")?.fed, false);
});

test("latestFedByColony: a later Fed overrides an earlier Not-fed", () => {
  const m = latestFedByColony([
    { colony_id: "a", observed_at: "2026-06-07T09:00:00Z", fed: false },
    { colony_id: "a", observed_at: "2026-06-07T18:00:00Z", fed: true },
  ]);
  assert.equal(m.get("a")?.fed, true);
  assert.equal(m.get("a")?.at.toISOString(), "2026-06-07T18:00:00.000Z");
});

test("latestFedByColony: out-of-order input still picks the latest by observed_at", () => {
  const m = latestFedByColony([
    { colony_id: "a", observed_at: "2026-06-07T18:00:00Z", fed: true },
    { colony_id: "a", observed_at: "2026-06-07T09:00:00Z", fed: false },
  ]);
  assert.equal(m.get("a")?.fed, true);
});

test("latestFedByColony: independent per colony; missing colony is undefined", () => {
  const m = latestFedByColony([
    { colony_id: "a", observed_at: "2026-06-07T10:00:00Z", fed: true },
    { colony_id: "b", observed_at: "2026-06-07T10:00:00Z", fed: false },
  ]);
  assert.equal(m.get("a")?.fed, true);
  assert.equal(m.get("b")?.fed, false);
  assert.equal(m.get("c"), undefined);
});
