import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseAlertSettings,
  ALERT_BOUNDS,
  DEFAULT_FEEDING_MISSED_HOURS,
  DEFAULT_NOT_SEEN_DAYS,
  DEFAULT_REPEATED_NOT_SEEN,
} from "./alert-settings.ts";

// A valid baseline; individual tests override one field to probe its boundary.
const VALID = {
  notSeenDays: "7",
  repeatedNotSeen: "3",
  feedingMissedHours: "12",
};

test("accepts a fully valid triple and snake_cases it", () => {
  const r = parseAlertSettings({
    notSeenDays: "10",
    repeatedNotSeen: "4",
    feedingMissedHours: "8",
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.value, {
    not_seen_days: 10,
    repeated_not_seen: 4,
    feeding_missed_hours: 8,
  });
});

test("accepts numeric (not just string) inputs", () => {
  const r = parseAlertSettings({
    notSeenDays: 7,
    repeatedNotSeen: 3,
    feedingMissedHours: 12,
  });
  assert.equal(r.ok, true);
});

// ── not_seen_days bounds (1–60) ──────────────────────────────────────────────
test("not_seen_days: min (1) accepted, min−1 (0) rejected", () => {
  assert.equal(parseAlertSettings({ ...VALID, notSeenDays: "1" }).ok, true);
  const bad = parseAlertSettings({ ...VALID, notSeenDays: "0" });
  assert.equal(bad.ok, false);
  assert.equal(!bad.ok && bad.field, "not_seen_days");
});

test("not_seen_days: max (60) accepted, max+1 (61) rejected", () => {
  assert.equal(parseAlertSettings({ ...VALID, notSeenDays: "60" }).ok, true);
  const bad = parseAlertSettings({ ...VALID, notSeenDays: "61" });
  assert.equal(bad.ok, false);
  assert.equal(!bad.ok && bad.field, "not_seen_days");
});

// ── repeated_not_seen bounds (1–10) ──────────────────────────────────────────
test("repeated_not_seen: min (1) accepted, min−1 (0) rejected", () => {
  assert.equal(parseAlertSettings({ ...VALID, repeatedNotSeen: "1" }).ok, true);
  const bad = parseAlertSettings({ ...VALID, repeatedNotSeen: "0" });
  assert.equal(!bad.ok && bad.field, "repeated_not_seen");
});

test("repeated_not_seen: max (10) accepted, max+1 (11) rejected", () => {
  assert.equal(
    parseAlertSettings({ ...VALID, repeatedNotSeen: "10" }).ok,
    true,
  );
  const bad = parseAlertSettings({ ...VALID, repeatedNotSeen: "11" });
  assert.equal(!bad.ok && bad.field, "repeated_not_seen");
});

// ── feeding_missed_hours bounds (1–72) ───────────────────────────────────────
test("feeding_missed_hours: min (1) accepted, min−1 (0) rejected", () => {
  assert.equal(
    parseAlertSettings({ ...VALID, feedingMissedHours: "1" }).ok,
    true,
  );
  const bad = parseAlertSettings({ ...VALID, feedingMissedHours: "0" });
  assert.equal(!bad.ok && bad.field, "feeding_missed_hours");
});

test("feeding_missed_hours: max (72) accepted, max+1 (73) rejected", () => {
  assert.equal(
    parseAlertSettings({ ...VALID, feedingMissedHours: "72" }).ok,
    true,
  );
  const bad = parseAlertSettings({ ...VALID, feedingMissedHours: "73" });
  assert.equal(!bad.ok && bad.field, "feeding_missed_hours");
});

// ── non-integer / non-numeric / empty (apply to every field) ─────────────────
test("rejects non-integer '7.5'", () => {
  assert.equal(parseAlertSettings({ ...VALID, notSeenDays: "7.5" }).ok, false);
  assert.equal(
    parseAlertSettings({ ...VALID, repeatedNotSeen: "3.5" }).ok,
    false,
  );
  assert.equal(
    parseAlertSettings({ ...VALID, feedingMissedHours: "12.5" }).ok,
    false,
  );
});

test("rejects non-numeric text", () => {
  const bad = parseAlertSettings({ ...VALID, notSeenDays: "abc" });
  assert.equal(!bad.ok && bad.field, "not_seen_days");
});

test("rejects empty string and whitespace-only", () => {
  assert.equal(parseAlertSettings({ ...VALID, notSeenDays: "" }).ok, false);
  assert.equal(parseAlertSettings({ ...VALID, notSeenDays: "   " }).ok, false);
});

test("rejects null / undefined", () => {
  assert.equal(parseAlertSettings({ ...VALID, notSeenDays: null }).ok, false);
  assert.equal(
    parseAlertSettings({ ...VALID, notSeenDays: undefined }).ok,
    false,
  );
});

test("rejects negative numbers", () => {
  assert.equal(parseAlertSettings({ ...VALID, notSeenDays: "-5" }).ok, false);
});

test("reports the FIRST bad field (declaration order)", () => {
  const bad = parseAlertSettings({
    notSeenDays: "0",
    repeatedNotSeen: "0",
    feedingMissedHours: "0",
  });
  assert.equal(!bad.ok && bad.field, "not_seen_days");
});

// ── defaults + bounds constants ──────────────────────────────────────────────
test("exposes the engine defaults for the no-row fallback", () => {
  assert.equal(DEFAULT_NOT_SEEN_DAYS, 7);
  assert.equal(DEFAULT_REPEATED_NOT_SEEN, 3);
  assert.equal(DEFAULT_FEEDING_MISSED_HOURS, 12);
});

test("bounds constants match the documented ranges", () => {
  assert.deepEqual(ALERT_BOUNDS.not_seen_days, { min: 1, max: 60 });
  assert.deepEqual(ALERT_BOUNDS.repeated_not_seen, { min: 1, max: 10 });
  assert.deepEqual(ALERT_BOUNDS.feeding_missed_hours, { min: 1, max: 72 });
});
