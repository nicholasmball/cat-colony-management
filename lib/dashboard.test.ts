import { test } from "node:test";
import assert from "node:assert/strict";
import {
  capRowsPerKey,
  summariseTodayFeeds,
  isDashboardAllClear,
  PER_CAT_SIGHTING_CAP,
} from "./dashboard.ts";

// ── capRowsPerKey: the load-bearing per-cat bound (CONDITION 1) ──────────────

test("capRowsPerKey: a busy cat does not starve another cat's run", () => {
  // 12 rows for the busy cat 'a' (more than the cap), then a single older row
  // for cat 'b'. A global limit of 10 would keep only cat 'a' rows and DROP
  // cat 'b' entirely. Per-key bounding must retain cat 'b'.
  const rows = [
    ...Array.from({ length: 12 }, (_, i) => ({
      cat_id: "a",
      observed_at: `2026-06-${String(20 - i).padStart(2, "0")}T10:00:00Z`,
    })),
    { cat_id: "b", observed_at: "2026-05-01T10:00:00Z" },
  ];
  const byCat = capRowsPerKey(rows, (r) => r.cat_id);
  assert.equal(byCat.get("a")?.length, PER_CAT_SIGHTING_CAP);
  assert.equal(byCat.get("b")?.length, 1);
  assert.equal(byCat.get("b")?.[0].observed_at, "2026-05-01T10:00:00Z");
});

test("capRowsPerKey: keeps the most-recent K per key, preserving input order", () => {
  // Newest-first input; with cap 2 we keep the first two for the key.
  const rows = [
    { cat_id: "a", observed_at: "2026-06-03T00:00:00Z" },
    { cat_id: "a", observed_at: "2026-06-02T00:00:00Z" },
    { cat_id: "a", observed_at: "2026-06-01T00:00:00Z" },
  ];
  const byCat = capRowsPerKey(rows, (r) => r.cat_id, 2);
  assert.deepEqual(
    byCat.get("a")?.map((r) => r.observed_at),
    ["2026-06-03T00:00:00Z", "2026-06-02T00:00:00Z"],
  );
});

test("capRowsPerKey: empty input yields an empty map; never mutates input", () => {
  const rows: { cat_id: string }[] = [];
  const byCat = capRowsPerKey(rows, (r) => r.cat_id);
  assert.equal(byCat.size, 0);
});

// ── summariseTodayFeeds: the today-counts roll-up ────────────────────────────

test("summariseTodayFeeds: counts each status and the total", () => {
  const counts = summariseTodayFeeds([
    "fed",
    "fed",
    "pending",
    "missed",
    "fed",
  ]);
  assert.deepEqual(counts, { total: 5, fed: 3, pending: 1, missed: 1 });
});

test("summariseTodayFeeds: no colonies is all zeroes (edge)", () => {
  assert.deepEqual(summariseTodayFeeds([]), {
    total: 0,
    fed: 0,
    pending: 0,
    missed: 0,
  });
});

// ── isDashboardAllClear: the whole-page reducer ──────────────────────────────

test("isDashboardAllClear: every actionable section empty → all clear", () => {
  assert.equal(
    isDashboardAllClear({
      missedFeeds: 0,
      newCatReports: 0,
      urgentIncidents: 0,
      concernCats: 0,
    }),
    true,
  );
});

test("isDashboardAllClear: any actionable section non-empty → not all clear", () => {
  assert.equal(
    isDashboardAllClear({
      missedFeeds: 0,
      newCatReports: 0,
      urgentIncidents: 1,
      concernCats: 0,
    }),
    false,
  );
});
