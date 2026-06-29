import { test } from "node:test";
import assert from "node:assert/strict";
import {
  concernCandidate,
  concernReasonText,
  DEFAULT_NOT_SEEN_DAYS,
  DEFAULT_REPEATED_NOT_SEEN,
} from "./cat-concern.ts";

// Fixed "now" so every case is deterministic — time is passed in, never read.
const NOW = new Date("2026-06-08T12:00:00Z");

// Helper: an ISO timestamp `days` whole days before NOW.
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

test("defaults are 7 days / 3 consecutive", () => {
  assert.equal(DEFAULT_NOT_SEEN_DAYS, 7);
  assert.equal(DEFAULT_REPEATED_NOT_SEEN, 3);
});

test("concern: latest sighting status is concern", () => {
  const r = concernCandidate({
    status: "active",
    sightings: [
      { status: "seen", observed_at: daysAgo(2) },
      { status: "concern", observed_at: daysAgo(1) },
    ],
    now: NOW,
  });
  assert.deepEqual(r, { reason: "concern", count: 0, monitoring: false });
});

test("not_seen_days: 7-day boundary — exactly 7 days since last seen flags", () => {
  const r = concernCandidate({
    status: "active",
    sightings: [
      { status: "seen", observed_at: daysAgo(7) },
      { status: "not_seen", observed_at: daysAgo(1) },
    ],
    now: NOW,
  });
  assert.equal(r?.reason, "not_seen_days");
  assert.equal(r?.count, 7);
});

test("not_seen_days: just under the window (6 days) is NOT a candidate", () => {
  const r = concernCandidate({
    status: "active",
    sightings: [
      { status: "seen", observed_at: daysAgo(6) },
      { status: "not_seen", observed_at: daysAgo(1) },
    ],
    now: NOW,
  });
  assert.equal(r, null);
});

test("repeated_not_seen: 3 consecutive non-seen (no seen) flags", () => {
  const r = concernCandidate({
    status: "active",
    sightings: [
      { status: "seen", observed_at: daysAgo(5) },
      { status: "not_seen", observed_at: daysAgo(4) },
      { status: "not_seen", observed_at: daysAgo(3) },
      { status: "not_seen", observed_at: daysAgo(2) },
    ],
    now: NOW,
  });
  // Last seen was 5 days ago (< 7), so it's the repeated-run reason, run = 3.
  assert.equal(r?.reason, "repeated_not_seen");
  assert.equal(r?.count, 3);
});

test("repeated_not_seen: not_seen, not_seen, seen (latest seen) is NOT a candidate", () => {
  const r = concernCandidate({
    status: "active",
    sightings: [
      { status: "not_seen", observed_at: daysAgo(3) },
      { status: "not_seen", observed_at: daysAgo(2) },
      { status: "seen", observed_at: daysAgo(1) },
    ],
    now: NOW,
  });
  assert.equal(r, null);
});

test("repeated_not_seen: a seen breaks the run below threshold → not a candidate", () => {
  const r = concernCandidate({
    status: "active",
    sightings: [
      { status: "not_seen", observed_at: daysAgo(5) },
      { status: "seen", observed_at: daysAgo(4) },
      { status: "not_seen", observed_at: daysAgo(2) },
      { status: "not_seen", observed_at: daysAgo(1) },
    ],
    now: NOW,
  });
  // Run of latest non-seen is only 2 (< 3); last seen 4 days ago (< 7).
  assert.equal(r, null);
});

test("seen recently: latest sighting is seen → not a candidate", () => {
  const r = concernCandidate({
    status: "active",
    sightings: [
      { status: "not_seen", observed_at: daysAgo(10) },
      { status: "seen", observed_at: daysAgo(1) },
    ],
    now: NOW,
  });
  assert.equal(r, null);
});

test("zero sightings ever: never a candidate (no baseline)", () => {
  const r = concernCandidate({ status: "active", sightings: [], now: NOW });
  assert.equal(r, null);
});

test("new_unconfirmed cat is NEVER a concern candidate (belongs to New queue)", () => {
  const r = concernCandidate({
    status: "new_unconfirmed",
    sightings: [
      { status: "not_seen", observed_at: daysAgo(20) },
      { status: "not_seen", observed_at: daysAgo(10) },
    ],
    now: NOW,
  });
  assert.equal(r, null);
});

test("ignored review newer than the signal clears the candidate", () => {
  const r = concernCandidate({
    status: "active",
    sightings: [
      { status: "seen", observed_at: daysAgo(20) },
      { status: "not_seen", observed_at: daysAgo(10) },
    ],
    reviews: [{ outcome: "ignored", created_at: daysAgo(5) }],
    now: NOW,
  });
  assert.equal(r, null);
});

test("ignored, then a FRESH non-seen signal re-raises the candidate", () => {
  const r = concernCandidate({
    status: "active",
    sightings: [
      { status: "seen", observed_at: daysAgo(20) },
      { status: "not_seen", observed_at: daysAgo(10) },
      // a new non-seen after the review re-raises it
      { status: "not_seen", observed_at: daysAgo(2) },
    ],
    reviews: [{ outcome: "ignored", created_at: daysAgo(5) }],
    now: NOW,
  });
  assert.equal(r?.reason, "not_seen_days");
  assert.equal(r?.monitoring, false);
});

test("monitoring review keeps the cat visible with monitoring=true", () => {
  const r = concernCandidate({
    status: "active",
    sightings: [
      { status: "seen", observed_at: daysAgo(20) },
      { status: "not_seen", observed_at: daysAgo(10) },
    ],
    reviews: [{ outcome: "monitoring", created_at: daysAgo(5) }],
    now: NOW,
  });
  assert.equal(r?.monitoring, true);
  assert.equal(r?.reason, "not_seen_days");
});

test("monitoring, then a fresh signal: still visible, now back to active candidate", () => {
  const r = concernCandidate({
    status: "active",
    sightings: [
      { status: "seen", observed_at: daysAgo(20) },
      { status: "not_seen", observed_at: daysAgo(2) },
    ],
    reviews: [{ outcome: "monitoring", created_at: daysAgo(5) }],
    now: NOW,
  });
  // Signal (2d) is newer than review (5d) → re-raised, no longer monitoring.
  assert.equal(r?.monitoring, false);
});

test("absent thresholds fall back to defaults (7/3)", () => {
  // 7 days since seen with empty thresholds object must flag like the default.
  const r = concernCandidate({
    status: "active",
    sightings: [
      { status: "seen", observed_at: daysAgo(7) },
      { status: "not_seen", observed_at: daysAgo(1) },
    ],
    thresholds: {},
    now: NOW,
  });
  assert.equal(r?.reason, "not_seen_days");
});

test("custom thresholds are honoured (not_seen_days = 3)", () => {
  const r = concernCandidate({
    status: "active",
    sightings: [
      { status: "seen", observed_at: daysAgo(4) },
      { status: "not_seen", observed_at: daysAgo(1) },
    ],
    thresholds: { not_seen_days: 3, repeated_not_seen: 3 },
    now: NOW,
  });
  assert.equal(r?.reason, "not_seen_days");
  assert.equal(r?.count, 4);
});

test("concernReasonText: concern, day singular/plural, times", () => {
  assert.equal(
    concernReasonText({ reason: "concern", count: 0 }),
    "Flagged: concern",
  );
  assert.equal(
    concernReasonText({ reason: "not_seen_days", count: 1 }),
    "Not seen 1 day",
  );
  assert.equal(
    concernReasonText({ reason: "not_seen_days", count: 9 }),
    "Not seen 9 days",
  );
  assert.equal(
    concernReasonText({ reason: "repeated_not_seen", count: 3 }),
    "Not seen 3 times in a row",
  );
});

// ── Never-seen cats (no `seen` baseline) — AC E: a single un-tapped feed must
// never mark a cat missing; the 7-day / 3-consecutive thresholds still apply ───
test("never-seen + single recent not_seen → NOT a candidate (AC E)", () => {
  // The #4 grid default ("I checked the whole colony") writes one not_seen per
  // un-tapped cat. A cat with no prior `seen` and only that fresh not_seen has a
  // ~0-day gap → must not be flagged on a single absence.
  const r = concernCandidate({
    status: "active",
    sightings: [{ status: "not_seen", observed_at: daysAgo(0) }],
    now: NOW,
  });
  assert.equal(r, null);
});

test("never-seen + oldest not_seen exactly 7 days ago → not_seen_days, count 7", () => {
  const r = concernCandidate({
    status: "active",
    sightings: [
      { status: "not_seen", observed_at: daysAgo(7) },
      { status: "not_seen", observed_at: daysAgo(1) },
    ],
    now: NOW,
  });
  assert.equal(r?.reason, "not_seen_days");
  assert.equal(r?.count, 7);
});

test("never-seen + oldest not_seen 6 days ago → NOT a candidate (under window)", () => {
  const r = concernCandidate({
    status: "active",
    sightings: [
      { status: "not_seen", observed_at: daysAgo(6) },
      { status: "not_seen", observed_at: daysAgo(1) },
    ],
    now: NOW,
  });
  // Gap is 6 (< 7) and the run of 2 is < 3 → neither threshold crossed.
  assert.equal(r, null);
});

test("never-seen + 3 consecutive not_seen within 7 days → repeated_not_seen, count 3", () => {
  const r = concernCandidate({
    status: "active",
    sightings: [
      { status: "not_seen", observed_at: daysAgo(3) },
      { status: "not_seen", observed_at: daysAgo(2) },
      { status: "not_seen", observed_at: daysAgo(1) },
    ],
    now: NOW,
  });
  // Oldest gap is 3 (< 7) so not_seen_days doesn't fire; the run of 3 does.
  assert.equal(r?.reason, "repeated_not_seen");
  assert.equal(r?.count, 3);
});

test("regression: seen baseline older than 7 days + latest not_seen → still not_seen_days", () => {
  // Proves the never-seen fix didn't break the baseline path (the `!lastSeen`
  // branch removed from noRecentSeen never applied when a `seen` exists).
  const r = concernCandidate({
    status: "active",
    sightings: [
      { status: "seen", observed_at: daysAgo(9) },
      { status: "not_seen", observed_at: daysAgo(1) },
    ],
    now: NOW,
  });
  assert.equal(r?.reason, "not_seen_days");
  assert.equal(r?.count, 9);
});

test("input order does not matter (unordered sightings)", () => {
  const r = concernCandidate({
    status: "active",
    sightings: [
      { status: "not_seen", observed_at: daysAgo(1) },
      { status: "seen", observed_at: daysAgo(8) },
      { status: "not_seen", observed_at: daysAgo(3) },
    ],
    now: NOW,
  });
  // Latest is the 1-day not_seen; last seen 8 days ago (≥ 7) → not_seen_days.
  assert.equal(r?.reason, "not_seen_days");
  assert.equal(r?.count, 8);
});
