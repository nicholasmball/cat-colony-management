import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planIncidentAlert,
  planNewCatAlert,
  planConcernSightingAlert,
  planFeedingMissedAlerts,
  planNotSeenAlerts,
  dedupKey,
} from "./alert-engine.ts";
import { MISSED_AFTER_MIN } from "./feeding-status.ts";

// Fixed "now" so every time-based case is deterministic.
const NOW = new Date("2026-06-09T12:00:00Z");
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

// ── dedup-key shapes (the engine's idempotency anchor) ───────────────────────
test("dedup-key shapes match the documented format", () => {
  assert.equal(
    dedupKey.feedingMissed("col1", "win1", "2026-06-09"),
    "feeding_missed:col1:win1:2026-06-09",
  );
  assert.equal(dedupKey.incidentUrgent("inc1"), "incident_urgent:inc1");
  assert.equal(dedupKey.incidentRoutine("inc1"), "incident_routine:inc1");
  assert.equal(dedupKey.newCat("cat1"), "new_cat:cat1");
  assert.equal(
    dedupKey.concern("cat1", "2026-06-09T10:00:00Z"),
    "concern:cat1:2026-06-09T10:00:00Z",
  );
  assert.equal(
    dedupKey.notSeen("cat1", "2026-06-02T08:00:00Z"),
    "not_seen:cat1:2026-06-02T08:00:00Z",
  );
});

// ── CONDITION: incident_urgent ───────────────────────────────────────────────
test("urgent incident → one urgent spec, push+sms-bound severity", () => {
  const specs = planIncidentAlert({
    incidentId: "inc1",
    colonyId: "col1",
    catId: "cat1",
    incidentType: "poisoning",
    colonyName: "Riverside",
    reporterName: "Ana",
    urgent: true,
  });
  assert.equal(specs.length, 1);
  assert.equal(specs[0].type, "incident_urgent");
  assert.equal(specs[0].severity, "urgent");
  assert.equal(specs[0].message_key, "alerts.incident_urgent");
  assert.equal(specs[0].incident_id, "inc1");
  assert.equal(specs[0].cat_id, "cat1");
  assert.equal(specs[0].dedup_key, "incident_urgent:inc1");
  assert.deepEqual(specs[0].message_params, {
    incidentType: "poisoning",
    colonyName: "Riverside",
    reporterName: "Ana",
  });
});

test("urgent incident already alerted (key in existing set) → zero specs", () => {
  const specs = planIncidentAlert(
    {
      incidentId: "inc1",
      colonyId: "col1",
      incidentType: "poisoning",
      colonyName: "Riverside",
      reporterName: "Ana",
      urgent: true,
    },
    new Set(["incident_urgent:inc1"]),
  );
  assert.deepEqual(specs, []);
});

// ── CONDITION: incident_routine (routine incidents DO alert — approved) ───────
test("routine incident → one routine spec (approved: routine incidents alert)", () => {
  const specs = planIncidentAlert({
    incidentId: "inc2",
    colonyId: "col1",
    incidentType: "access_problem",
    colonyName: "Riverside",
    reporterName: "Ana",
    urgent: false,
  });
  assert.equal(specs.length, 1);
  assert.equal(specs[0].type, "incident_routine");
  assert.equal(specs[0].severity, "routine");
  assert.equal(specs[0].dedup_key, "incident_routine:inc2");
});

// ── CONDITION: new_cat ───────────────────────────────────────────────────────
test("new cat → one routine new_cat spec; dedup per cat", () => {
  const input = {
    catId: "cat9",
    colonyId: "col1",
    colonyName: "Riverside",
    catName: "Smudge",
    reporterName: "Ana",
  };
  const specs = planNewCatAlert(input);
  assert.equal(specs.length, 1);
  assert.equal(specs[0].type, "new_cat");
  assert.equal(specs[0].severity, "routine");
  assert.equal(specs[0].cat_id, "cat9");
  assert.equal(specs[0].dedup_key, "new_cat:cat9");

  // With the key already present → zero.
  assert.deepEqual(planNewCatAlert(input, new Set(["new_cat:cat9"])), []);
});

// ── CONDITION: concern sighting ──────────────────────────────────────────────
test("concern sighting → one routine concern spec keyed by observed_at", () => {
  const input = {
    catId: "cat9",
    colonyId: "col1",
    colonyName: "Riverside",
    catName: "Smudge",
    reporterName: "Ana",
    observedAt: "2026-06-09T10:00:00Z",
  };
  const specs = planConcernSightingAlert(input);
  assert.equal(specs.length, 1);
  assert.equal(specs[0].type, "concern");
  assert.equal(specs[0].severity, "routine");
  assert.equal(specs[0].dedup_key, "concern:cat9:2026-06-09T10:00:00Z");

  assert.deepEqual(
    planConcernSightingAlert(
      input,
      new Set(["concern:cat9:2026-06-09T10:00:00Z"]),
    ),
    [],
  );
});

// ── CONDITION: feeding_missed — now PER WINDOW (reuses feedingStatus) ─────────
const MISSED_MIN = MISSED_AFTER_MIN + 1; // just past the 12h threshold

test("feeding_missed: single window closed past threshold, not fed → one spec (single-window parity)", () => {
  const specs = planFeedingMissedAlerts({
    localDate: "2026-06-09",
    colonies: [
      {
        colonyId: "col1",
        colonyName: "Riverside",
        thresholdHours: 12,
        windows: [
          { windowKey: "w1", fed: false, minutesAfterClose: MISSED_MIN },
        ],
      },
    ],
  });
  assert.equal(specs.length, 1);
  assert.equal(specs[0].type, "feeding_missed");
  assert.equal(specs[0].severity, "routine");
  assert.equal(specs[0].dedup_key, "feeding_missed:col1:w1:2026-06-09");
  assert.deepEqual(specs[0].message_params, {
    colonyName: "Riverside",
    hours: 12,
  });
});

test("feeding_missed: morning fed + evening unfed → ONLY the evening window alerts", () => {
  const specs = planFeedingMissedAlerts({
    localDate: "2026-06-09",
    colonies: [
      {
        colonyId: "col1",
        colonyName: "Riverside",
        thresholdHours: 12,
        windows: [
          { windowKey: "morning", fed: true, minutesAfterClose: MISSED_MIN },
          { windowKey: "evening", fed: false, minutesAfterClose: MISSED_MIN },
        ],
      },
    ],
  });
  assert.equal(specs.length, 1);
  assert.equal(specs[0].dedup_key, "feeding_missed:col1:evening:2026-06-09");
});

test("feeding_missed: both windows fed → no specs", () => {
  const specs = planFeedingMissedAlerts({
    localDate: "2026-06-09",
    colonies: [
      {
        colonyId: "col1",
        colonyName: "Riverside",
        thresholdHours: 12,
        windows: [
          { windowKey: "morning", fed: true, minutesAfterClose: MISSED_MIN },
          { windowKey: "evening", fed: true, minutesAfterClose: MISSED_MIN },
        ],
      },
    ],
  });
  assert.deepEqual(specs, []);
});

test("feeding_missed: both windows unfed + past threshold → two distinct, stable dedup keys", () => {
  const input = {
    localDate: "2026-06-09",
    colonies: [
      {
        colonyId: "col1",
        colonyName: "Riverside",
        thresholdHours: 12,
        windows: [
          { windowKey: "morning", fed: false, minutesAfterClose: MISSED_MIN },
          { windowKey: "evening", fed: false, minutesAfterClose: MISSED_MIN },
        ],
      },
    ],
  };
  const specs = planFeedingMissedAlerts(input);
  assert.equal(specs.length, 2);
  const keys = specs.map((s) => s.dedup_key).sort();
  assert.deepEqual(keys, [
    "feeding_missed:col1:evening:2026-06-09",
    "feeding_missed:col1:morning:2026-06-09",
  ]);
  // Re-run yields the same keys (stable) — and with both already present the
  // planner emits nothing (idempotent across the 15-min cron re-scan).
  const rerun = planFeedingMissedAlerts(input, new Set(keys));
  assert.deepEqual(rerun, []);
});

test("feeding_missed: zero-window colony → no specs", () => {
  const specs = planFeedingMissedAlerts({
    localDate: "2026-06-09",
    colonies: [
      {
        colonyId: "col1",
        colonyName: "Riverside",
        thresholdHours: 12,
        windows: [],
      },
    ],
  });
  assert.deepEqual(specs, []);
});

test("feeding_missed: window not yet past threshold → pending, no spec", () => {
  const specs = planFeedingMissedAlerts({
    localDate: "2026-06-09",
    colonies: [
      {
        colonyId: "col1",
        colonyName: "Riverside",
        thresholdHours: 12,
        windows: [
          {
            windowKey: "w1",
            fed: false,
            minutesAfterClose: MISSED_AFTER_MIN - 1,
          },
        ],
      },
    ],
  });
  assert.deepEqual(specs, []);
});

test("feeding_missed: existing per-window dedup key → zero specs (idempotent)", () => {
  const specs = planFeedingMissedAlerts(
    {
      localDate: "2026-06-09",
      colonies: [
        {
          colonyId: "col1",
          colonyName: "Riverside",
          thresholdHours: 12,
          windows: [
            { windowKey: "w1", fed: false, minutesAfterClose: MISSED_MIN },
          ],
        },
      ],
    },
    new Set(["feeding_missed:col1:w1:2026-06-09"]),
  );
  assert.deepEqual(specs, []);
});

// ── CONDITION: not_seen (reuses concernCandidate verbatim) ───────────────────
test("not_seen: cat past the not-seen window → one spec keyed by streak start", () => {
  const streakStart = daysAgo(8); // oldest non-seen in the run
  const specs = planNotSeenAlerts({
    now: NOW,
    cats: [
      {
        catId: "cat1",
        colonyId: "col1",
        colonyName: "Riverside",
        catName: "Smudge",
        status: "active",
        sightings: [
          { status: "seen", observed_at: daysAgo(20) },
          { status: "not_seen", observed_at: streakStart },
          { status: "not_seen", observed_at: daysAgo(1) },
        ],
      },
    ],
  });
  assert.equal(specs.length, 1);
  assert.equal(specs[0].type, "not_seen");
  assert.equal(specs[0].severity, "routine");
  assert.equal(specs[0].cat_id, "cat1");
  assert.equal(specs[0].message_params.reason, "not_seen_days");
  assert.equal(specs[0].dedup_key, `not_seen:cat1:${streakStart}`);
});

test("not_seen: repeated-not-seen run → spec with repeated reason", () => {
  const streakStart = daysAgo(3);
  const specs = planNotSeenAlerts({
    now: NOW,
    thresholds: { not_seen_days: 30, repeated_not_seen: 3 },
    cats: [
      {
        catId: "cat1",
        colonyId: "col1",
        colonyName: "Riverside",
        catName: "Smudge",
        status: "active",
        sightings: [
          { status: "seen", observed_at: daysAgo(4) },
          { status: "not_seen", observed_at: streakStart },
          { status: "not_seen", observed_at: daysAgo(2) },
          { status: "not_seen", observed_at: daysAgo(1) },
        ],
      },
    ],
  });
  assert.equal(specs.length, 1);
  assert.equal(specs[0].message_params.reason, "repeated_not_seen");
  assert.equal(specs[0].message_params.count, 3);
  assert.equal(specs[0].dedup_key, `not_seen:cat1:${streakStart}`);
});

test("not_seen: a recently-seen cat is not a candidate → zero specs", () => {
  const specs = planNotSeenAlerts({
    now: NOW,
    cats: [
      {
        catId: "cat1",
        colonyId: "col1",
        colonyName: "Riverside",
        catName: "Smudge",
        status: "active",
        sightings: [{ status: "seen", observed_at: daysAgo(1) }],
      },
    ],
  });
  assert.deepEqual(specs, []);
});

test("not_seen: a live 'concern' flag is owned by the event hook → zero specs", () => {
  const specs = planNotSeenAlerts({
    now: NOW,
    cats: [
      {
        catId: "cat1",
        colonyId: "col1",
        colonyName: "Riverside",
        catName: "Smudge",
        status: "active",
        sightings: [
          { status: "seen", observed_at: daysAgo(2) },
          { status: "concern", observed_at: daysAgo(1) },
        ],
      },
    ],
  });
  assert.deepEqual(specs, []);
});

test("not_seen: a monitoring review suppresses the cron alert → zero specs", () => {
  const specs = planNotSeenAlerts({
    now: NOW,
    cats: [
      {
        catId: "cat1",
        colonyId: "col1",
        colonyName: "Riverside",
        catName: "Smudge",
        status: "active",
        sightings: [
          { status: "seen", observed_at: daysAgo(20) },
          { status: "not_seen", observed_at: daysAgo(8) },
        ],
        reviews: [{ outcome: "monitoring", created_at: daysAgo(1) }],
      },
    ],
  });
  assert.deepEqual(specs, []);
});

test("not_seen: existing dedup key for the same streak → zero specs (idempotent)", () => {
  const streakStart = daysAgo(8);
  const cat = {
    catId: "cat1",
    colonyId: "col1",
    colonyName: "Riverside",
    catName: "Smudge",
    status: "active",
    sightings: [
      { status: "seen" as const, observed_at: daysAgo(20) },
      { status: "not_seen" as const, observed_at: streakStart },
    ],
  };
  const specs = planNotSeenAlerts(
    { now: NOW, cats: [cat] },
    new Set([`not_seen:cat1:${streakStart}`]),
  );
  assert.deepEqual(specs, []);
});

// ── SAFETY: the tap-to-mark-seen grid's not_seen write pattern ───────────────
// The grid (components/feed-form.tsx + lib/feed-sightings.ts) writes one
// not_seen sighting per un-tapped cat when "I checked the whole colony" is ON.
// These cases prove that new, higher-volume not_seen pattern does NOT change the
// time-based alert behaviour: a single absence never alerts, and a re-sighting
// breaks the streak. The alert-engine logic is unchanged — this just pins the
// data pattern as safe.
test("grid pattern: a single feed's not_seen after a recent sighting does NOT alert", () => {
  // A cat with a baseline (seen 3 days ago) that's un-tapped on today's round
  // gets ONE not_seen. That's below not_seen_days (7) and repeated_not_seen (3)
  // → time-based, no immediate alert / missing mark on a single absence.
  const specs = planNotSeenAlerts({
    now: NOW,
    cats: [
      {
        catId: "cat1",
        colonyId: "col1",
        colonyName: "Riverside",
        catName: "Smudge",
        status: "active",
        sightings: [
          { status: "seen", observed_at: daysAgo(3) },
          { status: "not_seen", observed_at: daysAgo(0) },
        ],
      },
    ],
  });
  assert.deepEqual(
    specs,
    [],
    "one not_seen must never immediately alert / mark missing",
  );
});

test("grid pattern: a NEVER-SEEN cat's single not_seen today does NOT alert (AC E)", () => {
  // A cat with NO prior `seen` baseline that's un-tapped on today's round gets
  // ONE not_seen. The gap from its oldest (only) sighting is ~0 days → below
  // not_seen_days (7) and the run of 1 is below repeated_not_seen (3). This is
  // the exact case the baseline-using tests above miss: a single absence on a
  // never-seen cat must never auto-mark it missing.
  const specs = planNotSeenAlerts({
    now: NOW,
    cats: [
      {
        catId: "cat1",
        colonyId: "col1",
        colonyName: "Riverside",
        catName: "Smudge",
        status: "active",
        sightings: [{ status: "not_seen", observed_at: daysAgo(0) }],
      },
    ],
  });
  assert.deepEqual(
    specs,
    [],
    "a never-seen cat's single not_seen must never alert / mark missing",
  );
});

test("grid pattern: two un-tapped feeds (2 consecutive) still below the 3-streak → no alert", () => {
  // Default repeated_not_seen = 3, not_seen_days = 7. A recent seen baseline +
  // two consecutive not_seen marks (e.g. two part-rounds this cat was un-tapped)
  // is NOT yet missing — both thresholds must be crossed.
  const specs = planNotSeenAlerts({
    now: NOW,
    cats: [
      {
        catId: "cat1",
        colonyId: "col1",
        colonyName: "Riverside",
        catName: "Smudge",
        status: "active",
        sightings: [
          { status: "seen", observed_at: daysAgo(3) },
          { status: "not_seen", observed_at: daysAgo(2) },
          { status: "not_seen", observed_at: daysAgo(1) },
        ],
      },
    ],
  });
  assert.deepEqual(specs, [], "two absences must not mark a cat missing");
});

test("grid pattern: a re-sighting (tapped seen) at the head breaks the streak → no alert", () => {
  // A long not_seen run that WOULD alert, but the latest feed tapped the cat
  // seen. notSeenStreakStart finds no open run → no spec. Re-sighting clears it.
  const specs = planNotSeenAlerts({
    now: NOW,
    cats: [
      {
        catId: "cat1",
        colonyId: "col1",
        colonyName: "Riverside",
        catName: "Smudge",
        status: "active",
        sightings: [
          { status: "not_seen", observed_at: daysAgo(9) },
          { status: "not_seen", observed_at: daysAgo(8) },
          { status: "not_seen", observed_at: daysAgo(7) },
          { status: "seen", observed_at: daysAgo(0) },
        ],
      },
    ],
  });
  assert.deepEqual(specs, [], "a re-sighting must break the not-seen streak");
});
