import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_FEEDING_WINDOWS,
  orderWindows,
  windowKeyOf,
  windowRangeLabel,
  timeToMinutes,
  parseWindowRows,
  fedStateByWindow,
  colonyWindowStatuses,
  overallWindowStatus,
} from "./feeding-windows.ts";

// ── ordering ─────────────────────────────────────────────────────────────────
test("orderWindows sorts by position then start time (nulls last)", () => {
  const rows = [
    { id: "b", position: 2, window_start: "18:00", window_end: "19:00" },
    { id: "a", position: 1, window_start: "07:00", window_end: "08:00" },
    { id: "c", position: 1, window_start: null, window_end: null },
  ];
  const ordered = orderWindows(rows);
  assert.deepEqual(
    ordered.map((w) => w.id),
    ["a", "c", "b"],
  );
});

test("orderWindows does not mutate its input", () => {
  const rows = [
    { id: "b", position: 2, window_start: "18:00", window_end: "19:00" },
    { id: "a", position: 1, window_start: "07:00", window_end: "08:00" },
  ];
  const before = rows.map((r) => r.id);
  orderWindows(rows);
  assert.deepEqual(
    rows.map((r) => r.id),
    before,
  );
});

// ── small formatters ─────────────────────────────────────────────────────────
test("windowKeyOf prefers the row id, falls back to position", () => {
  assert.equal(
    windowKeyOf({
      id: "abc",
      position: 2,
      window_start: null,
      window_end: null,
    }),
    "abc",
  );
  assert.equal(
    windowKeyOf({ position: 3, window_start: null, window_end: null }),
    "p3",
  );
});

test("windowRangeLabel renders HH:MM range; both-null → empty", () => {
  assert.equal(windowRangeLabel("07:00:00", "08:00:00"), "07:00–08:00");
  assert.equal(windowRangeLabel("07:00", null), "07:00–—");
  assert.equal(windowRangeLabel(null, null), "");
});

test("timeToMinutes parses HH:MM[:SS]; blank → null", () => {
  assert.equal(timeToMinutes("07:30"), 450);
  assert.equal(timeToMinutes("18:00:00"), 1080);
  assert.equal(timeToMinutes(null), null);
  assert.equal(timeToMinutes(""), null);
});

// ── form parsing ─────────────────────────────────────────────────────────────
test("parseWindowRows drops both-empty rows and keeps complete pairs", () => {
  const res = parseWindowRows(["07:00", "", "18:00"], ["08:00", "", "19:00"]);
  assert.deepEqual(res, {
    ok: true,
    windows: [
      { window_start: "07:00", window_end: "08:00" },
      { window_start: "18:00", window_end: "19:00" },
    ],
  });
});

test("parseWindowRows rejects a half-filled pair with its 1-based ordinal", () => {
  const res = parseWindowRows(["07:00", "18:00"], ["08:00", ""]);
  assert.deepEqual(res, { ok: false, reason: "incomplete", row: 2 });
});

test("parseWindowRows enforces the 4-window cap", () => {
  const t = ["1", "2", "3", "4", "5"].map((h) => `0${h}:00`);
  const res = parseWindowRows(t, t);
  assert.deepEqual(res, { ok: false, reason: "tooMany" });
  assert.equal(MAX_FEEDING_WINDOWS, 4);
});

test("parseWindowRows: zero windows is valid (all rows empty)", () => {
  assert.deepEqual(parseWindowRows(["", ""], ["", ""]), {
    ok: true,
    windows: [],
  });
});

// ── per-window fed attribution ───────────────────────────────────────────────
const windows = [
  { key: "morning", startMinutes: 7 * 60 },
  { key: "evening", startMinutes: 18 * 60 },
];

test("fedStateByWindow attributes a morning feed to the morning window only", () => {
  const state = fedStateByWindow(windows, [
    {
      localMinutes: 7 * 60 + 12,
      observedAt: "2026-06-09T07:12:00Z",
      fed: true,
    },
  ]);
  assert.equal(state.get("morning")?.fed, true);
  assert.equal(state.get("morning")?.fedAt, "2026-06-09T07:12:00Z");
  assert.equal(state.get("evening")?.fed, false);
});

test("fedStateByWindow: both windows fed when each has its own feed", () => {
  const state = fedStateByWindow(windows, [
    { localMinutes: 7 * 60 + 5, observedAt: "2026-06-09T07:05:00Z", fed: true },
    {
      localMinutes: 18 * 60 + 5,
      observedAt: "2026-06-09T18:05:00Z",
      fed: true,
    },
  ]);
  assert.equal(state.get("morning")?.fed, true);
  assert.equal(state.get("evening")?.fed, true);
});

test("fedStateByWindow: a later 'not fed' correction overrides an earlier fed (per window)", () => {
  const state = fedStateByWindow(windows, [
    { localMinutes: 7 * 60 + 5, observedAt: "2026-06-09T07:05:00Z", fed: true },
    {
      localMinutes: 7 * 60 + 40,
      observedAt: "2026-06-09T07:40:00Z",
      fed: false,
    },
  ]);
  assert.equal(state.get("morning")?.fed, false);
  assert.equal(state.get("morning")?.fedAt, null);
});

test("fedStateByWindow: an event before all window starts falls to the earliest window", () => {
  const state = fedStateByWindow(windows, [
    { localMinutes: 6 * 60, observedAt: "2026-06-09T06:00:00Z", fed: true },
  ]);
  assert.equal(state.get("morning")?.fed, true);
  assert.equal(state.get("evening")?.fed, false);
});

test("fedStateByWindow: no windows → empty map", () => {
  assert.equal(fedStateByWindow([], []).size, 0);
});

// ── composed per-window status (display surfaces) ────────────────────────────
const TZ = "Europe/Lisbon"; // summer = UTC+1
const NOW = new Date("2026-06-09T21:00:00Z"); // 22:00 local June 9 — both windows have closed

test("colonyWindowStatuses: morning fed, evening missed after threshold", () => {
  const statuses = colonyWindowStatuses(
    [
      { id: "m", position: 1, window_start: "07:00", window_end: "08:00" },
      { id: "e", position: 2, window_start: "18:00", window_end: "19:00" },
    ],
    // a single morning feed (local 07:12 in Lisbon = 06:12 UTC)
    [{ observed_at: "2026-06-09T06:12:00Z", fed: true }],
    TZ,
    NOW,
    60, // 1h threshold so both closed windows are "past close"
  );
  const byKey = new Map(statuses.map((s) => [s.windowKey, s]));
  assert.equal(byKey.get("m")?.status, "fed");
  assert.equal(byKey.get("e")?.status, "missed");
});

test("colonyWindowStatuses: zero windows → empty list", () => {
  assert.deepEqual(colonyWindowStatuses([], [], TZ, NOW, 60), []);
});

test("overallWindowStatus rolls up worst-first", () => {
  assert.equal(overallWindowStatus(["fed", "missed", "pending"]), "missed");
  assert.equal(overallWindowStatus(["fed", "pending"]), "pending");
  assert.equal(overallWindowStatus(["fed", "fed"]), "fed");
  assert.equal(overallWindowStatus([]), "fed");
});
