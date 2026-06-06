import { test } from "node:test";
import assert from "node:assert/strict";
import {
  todayInTz,
  dayRangeInTz,
  minutesAfterWindow,
  isValidTimeZone,
} from "./time.ts";

// All tests pass an explicit `now`/date — never the real clock — so they are
// deterministic. Expected UTC instants were cross-checked against Intl.

const iso = (d: Date) => d.toISOString();
const hours = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3_600_000;

test("todayInTz returns the local calendar date", () => {
  // 01:30 UTC is still 5 Jun in Lisbon (summer, UTC+1 -> 02:30).
  assert.equal(
    todayInTz("Europe/Lisbon", new Date("2026-06-05T01:30:00Z")),
    "2026-06-05",
  );
});

test("todayInTz crosses midnight: UTC says 5th, Lisbon says 6th", () => {
  // 23:30 UTC -> 00:30 local next day.
  assert.equal(
    todayInTz("Europe/Lisbon", new Date("2026-06-05T23:30:00Z")),
    "2026-06-06",
  );
});

test("todayInTz for a non-Portugal zone (Pacific/Auckland, UTC+12)", () => {
  assert.equal(
    todayInTz("Pacific/Auckland", new Date("2026-06-05T12:30:00Z")),
    "2026-06-06",
  );
});

test("dayRangeInTz bounds a normal Lisbon day (UTC+1 in summer)", () => {
  const { startUtc, endUtc } = dayRangeInTz("Europe/Lisbon", "2026-06-05");
  assert.equal(iso(startUtc), "2026-06-04T23:00:00.000Z");
  assert.equal(iso(endUtc), "2026-06-05T23:00:00.000Z");
  assert.equal(hours(startUtc, endUtc), 24);
});

test("dayRangeInTz handles the Lisbon spring-forward day as 23 hours", () => {
  // 2026-03-29: clocks jump 01:00 WET -> 02:00 WEST.
  const { startUtc, endUtc } = dayRangeInTz("Europe/Lisbon", "2026-03-29");
  assert.equal(iso(startUtc), "2026-03-29T00:00:00.000Z");
  assert.equal(iso(endUtc), "2026-03-29T23:00:00.000Z");
  assert.equal(hours(startUtc, endUtc), 23);
});

test("dayRangeInTz handles the Lisbon fall-back day as 25 hours", () => {
  // 2026-10-25: clocks fall 02:00 WEST -> 01:00 WET.
  const { startUtc, endUtc } = dayRangeInTz("Europe/Lisbon", "2026-10-25");
  assert.equal(iso(startUtc), "2026-10-24T23:00:00.000Z");
  assert.equal(iso(endUtc), "2026-10-26T00:00:00.000Z");
  assert.equal(hours(startUtc, endUtc), 25);
});

test("dayRangeInTz bounds a non-Portugal day (Pacific/Auckland, UTC+12)", () => {
  const { startUtc, endUtc } = dayRangeInTz("Pacific/Auckland", "2026-06-05");
  assert.equal(iso(startUtc), "2026-06-04T12:00:00.000Z");
  assert.equal(iso(endUtc), "2026-06-05T12:00:00.000Z");
});

test("minutesAfterWindow is exactly 720 at the 12h missed threshold", () => {
  // Window closes 09:00 Lisbon (= 08:00 UTC in summer); 20:00 UTC is +12h.
  assert.equal(
    minutesAfterWindow("09:00", "Europe/Lisbon", new Date("2026-06-05T20:00:00Z")),
    720,
  );
});

test("minutesAfterWindow is negative before the window closes", () => {
  // 07:00 UTC = 08:00 Lisbon, one hour before the 09:00 close.
  assert.equal(
    minutesAfterWindow("09:00", "Europe/Lisbon", new Date("2026-06-05T07:00:00Z")),
    -60,
  );
});

test("minutesAfterWindow works for a non-Portugal org (Auckland)", () => {
  // 09:00 Auckland (UTC+12) = 21:00 UTC prev day; 09:00 UTC next is +12h.
  assert.equal(
    minutesAfterWindow("09:00", "Pacific/Auckland", new Date("2026-06-05T09:00:00Z")),
    720,
  );
});

test("isValidTimeZone accepts real zones and rejects junk", () => {
  assert.equal(isValidTimeZone("Europe/Lisbon"), true);
  assert.equal(isValidTimeZone("UTC"), true);
  assert.equal(isValidTimeZone("Not/AZone"), false);
  assert.equal(isValidTimeZone(""), false);
});
