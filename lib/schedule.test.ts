import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduleMatchesToday, localWeekday } from "./schedule.ts";

// Sat 2026-06-06 → weekday 6.
const today = { localDate: "2026-06-06", weekday: 6 };

test("recurring schedule matches when weekday is today", () => {
  assert.equal(
    scheduleMatchesToday(
      { weekday: 6, specific_date: null, is_active: true, deleted_at: null },
      today,
    ),
    true,
  );
});

test("recurring schedule misses on a different weekday", () => {
  assert.equal(
    scheduleMatchesToday(
      { weekday: 1, specific_date: null, is_active: true, deleted_at: null },
      today,
    ),
    false,
  );
});

test("one-off schedule matches when its date is today", () => {
  assert.equal(
    scheduleMatchesToday(
      {
        weekday: null,
        specific_date: "2026-06-06",
        is_active: true,
        deleted_at: null,
      },
      today,
    ),
    true,
  );
});

test("one-off schedule misses on a different date", () => {
  assert.equal(
    scheduleMatchesToday(
      {
        weekday: null,
        specific_date: "2026-06-07",
        is_active: true,
        deleted_at: null,
      },
      today,
    ),
    false,
  );
});

test("inactive schedule never matches even if the weekday lines up", () => {
  assert.equal(
    scheduleMatchesToday(
      { weekday: 6, specific_date: null, is_active: false, deleted_at: null },
      today,
    ),
    false,
  );
});

test("soft-deleted schedule never matches", () => {
  assert.equal(
    scheduleMatchesToday(
      {
        weekday: 6,
        specific_date: null,
        is_active: true,
        deleted_at: "2026-06-01T00:00:00Z",
      },
      today,
    ),
    false,
  );
});

test("tz boundary: matching uses the org-local date, not a UTC date", () => {
  // Just after local midnight Sun 2026-06-07 in Lisbon (UTC+1 in June) the UTC
  // instant is still Sat 2026-06-06 23:30Z. The org-local "today" is Sunday
  // (weekday 0), so a Sunday recurring row must match and a Saturday one must not.
  const localToday = { localDate: "2026-06-07", weekday: 0 };
  assert.equal(
    scheduleMatchesToday(
      { weekday: 0, specific_date: null, is_active: true, deleted_at: null },
      localToday,
    ),
    true,
  );
  assert.equal(
    scheduleMatchesToday(
      { weekday: 6, specific_date: null, is_active: true, deleted_at: null },
      localToday,
    ),
    false,
  );
});

test("localWeekday returns the correct day for a known date", () => {
  assert.equal(localWeekday("2026-06-06"), 6); // Saturday
  assert.equal(localWeekday("2026-06-07"), 0); // Sunday
  assert.equal(localWeekday("2026-06-01"), 1); // Monday
});
