// Pure, side-effect-free shaping helpers for the caretaker dashboard
// (app/app/dashboard/page.tsx). Kept free of React/Supabase/Next so the
// aggregation rules are trivially unit-testable and the page just renders.
//
// The dashboard is a READ-ONLY oversight roll-up: it reuses the existing tested
// detection (feedingStatus, concernCandidate, urgency levels) and only adds the
// in-memory *shaping* — counting today's feeds, capping sightings per cat, and
// deciding when the whole page is all-clear. Mirrors lib/feeding-status &
// lib/cat-concern: time is passed in, nothing reaches out.

import type { FeedingStatus } from "./feeding-status";

// How many of the most-recent rows we keep PER CAT for concern detection.
// concernCandidate only ever needs each cat's latest run: the not_seen_days
// window compares the most recent `seen` to now, and repeated_not_seen looks at
// the latest consecutive non-seen run (default 3). 10 is a generous headroom
// over the default-3 rule while staying tiny — enough to absorb a higher
// per-org repeated_not_seen threshold without losing the signal.
export const PER_CAT_SIGHTING_CAP = 10;

// Bound a flat, newest-first list of rows to the most recent K PER key — NOT a
// single global cap. CONDITION 1 (load-bearing): a global `.limit()` over a
// query spanning many cats lets one busy colony's chatter fill the budget and
// starve another cat's older-but-still-relevant run, silently hiding a
// not-seen cat. This keeps an independent K-deep bucket per key, so every cat
// retains its own recent run regardless of how noisy its neighbours are.
//
// `rows` MUST already be ordered newest-first (callers query
// `.order(orderField, { ascending: false })`); we preserve that order within
// each bucket and simply stop pushing once a bucket is full. Pure: returns a
// fresh Map, never mutates the input.
export function capRowsPerKey<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  cap: number = PER_CAT_SIGHTING_CAP,
): Map<string, T[]> {
  const byKey = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = byKey.get(key);
    if (bucket === undefined) {
      byKey.set(key, [row]);
    } else if (bucket.length < cap) {
      bucket.push(row);
    }
    // Bucket full → drop. Rows are newest-first, so the kept rows are the most
    // recent K for this key — exactly what the concern rules need.
  }
  return byKey;
}

export type TodayFeedCounts = {
  total: number;
  fed: number;
  pending: number;
  missed: number;
};

// Roll up per-colony feeding statuses into the dashboard's headline counts.
// One pass; the page derives the per-colony rows once (reusing feedingStatus)
// and feeds the resulting statuses here so the summary card and the "Missed
// feeds" filter agree on the same numbers.
export function summariseTodayFeeds(
  statuses: readonly FeedingStatus[],
): TodayFeedCounts {
  const counts: TodayFeedCounts = {
    total: statuses.length,
    fed: 0,
    pending: 0,
    missed: 0,
  };
  for (const s of statuses) counts[s] += 1;
  return counts;
}

// The per-section "is there anything to show" inputs the page has already
// computed. Each number is the count of actionable headline rows for that
// section (monitoring-only concern does NOT count as actionable — it never
// blocks the whole-page all-clear, matching the design's distinct sub-count).
export type DashboardCounts = {
  missedFeeds: number;
  newCatReports: number;
  urgentIncidents: number;
  concernCats: number;
};

// Whole-page all-clear when EVERY actionable section is empty. Drives the big
// "All clear across N colonies today" panel. Note: pending/fed feeds are normal
// daily state, so only MISSED feeds count against all-clear here (the four
// daily questions are "is anything wrong", not "is everything finished").
export function isDashboardAllClear(counts: DashboardCounts): boolean {
  return (
    counts.missedFeeds === 0 &&
    counts.newCatReports === 0 &&
    counts.urgentIncidents === 0 &&
    counts.concernCats === 0
  );
}
