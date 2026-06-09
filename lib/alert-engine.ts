// The PURE alert planner — the testable core of the alert engine.
//
// Given the raw inputs (an org's colonies + today's feeding events, or a cat's
// sightings + reviews, or a single new incident / cat / concern sighting), the
// org thresholds, a `now` PASSED IN, and the set of dedup keys that ALREADY
// exist, return the list of alert "specs" to insert — BEFORE recipient fan-out.
// The route/action turns each spec into one row per caretaker/admin, attaches
// the severity-derived channel intent (lib/alert-routing.channelsFor) and writes
// them with ON CONFLICT (recipient_id, dedup_key) DO NOTHING.
//
// PURE by design (mirrors lib/feeding-status & lib/cat-concern): no DB, no
// Date.now()/new Date() inside — time is the `now` argument so every case is
// deterministic. Detection is NEVER re-derived here: feeding-missed reuses
// feedingStatus/latestFedByColony and the not-seen/concern rules reuse
// concernCandidate/concernReasonKey verbatim. This file only adds the dedup-key
// shaping and the existing-key gate on top of that already-tested detection.

import {
  feedingStatus,
  latestFedByColony,
  type FeedEvent,
} from "./feeding-status.ts";
import {
  concernCandidate,
  concernReasonKey,
  type ConcernSighting,
  type ConcernReview,
  type ConcernThresholds,
} from "./cat-concern.ts";
import type { AlertSeverity } from "./alert-routing.ts";

// One planned alert, pre-fan-out. The recipient is resolved separately (one row
// per caretaker/admin); these fields are shared by every recipient's row.
export type AlertSpec = {
  type:
    | "feeding_missed"
    | "incident_urgent"
    | "incident_routine"
    | "new_cat"
    | "concern"
    | "not_seen";
  severity: AlertSeverity;
  message_key: string;
  message_params: Record<string, string | number>;
  colony_id?: string;
  cat_id?: string;
  incident_id?: string;
  dedup_key: string;
};

// All severities except the two incident kinds are routine (the content design:
// feeding_missed, new_cat, concern, not_seen are all "review when you can").
// incident severity is decided by the org's urgency level (alerts_immediately).

// ── Dedup-key shapes (single source of truth; mirrored in 0009's header) ──────
export const dedupKey = {
  feedingMissed: (colonyId: string, localDate: string) =>
    `feeding_missed:${colonyId}:${localDate}`,
  incidentUrgent: (incidentId: string) => `incident_urgent:${incidentId}`,
  incidentRoutine: (incidentId: string) => `incident_routine:${incidentId}`,
  newCat: (catId: string) => `new_cat:${catId}`,
  concern: (catId: string, observedAt: string) =>
    `concern:${catId}:${observedAt}`,
  notSeen: (catId: string, streakStart: string) =>
    `not_seen:${catId}:${streakStart}`,
};

// ── Event planners (fired off a user action, in the server actions) ──────────

// An incident was reported. Urgent (the level alerts_immediately) → push+sms;
// routine → in_app+email. Routine incidents DO raise an in-app alert (approved
// decision). Dedup is per incident id, so a double-submit can't double-alert.
export function planIncidentAlert(
  input: {
    incidentId: string;
    colonyId: string;
    catId?: string | null;
    incidentType: string; // a public.incident_type enum value
    colonyName: string;
    reporterName: string;
    urgent: boolean;
  },
  existing: ReadonlySet<string> = new Set(),
): AlertSpec[] {
  const severity: AlertSeverity = input.urgent ? "urgent" : "routine";
  const type = input.urgent ? "incident_urgent" : "incident_routine";
  const key = input.urgent
    ? dedupKey.incidentUrgent(input.incidentId)
    : dedupKey.incidentRoutine(input.incidentId);
  if (existing.has(key)) return [];
  return [
    {
      type,
      severity,
      message_key: `alerts.${type}`,
      // incidentType is stored raw so the renderer maps it via incidents.type.*
      // into the recipient's locale ("Poisoning" / "Envenenamento").
      message_params: {
        incidentType: input.incidentType,
        colonyName: input.colonyName,
        reporterName: input.reporterName,
      },
      colony_id: input.colonyId,
      cat_id: input.catId ?? undefined,
      incident_id: input.incidentId,
      dedup_key: key,
    },
  ];
}

// A feeder reported a NEW cat (status new_unconfirmed) awaiting confirm/reject.
// Routine. Dedup per cat id — one cat is reported once.
export function planNewCatAlert(
  input: {
    catId: string;
    colonyId: string;
    colonyName: string;
    catName: string;
    reporterName: string;
  },
  existing: ReadonlySet<string> = new Set(),
): AlertSpec[] {
  const key = dedupKey.newCat(input.catId);
  if (existing.has(key)) return [];
  return [
    {
      type: "new_cat",
      severity: "routine",
      message_key: "alerts.new_cat",
      message_params: {
        colonyName: input.colonyName,
        catName: input.catName,
        reporterName: input.reporterName,
      },
      colony_id: input.colonyId,
      cat_id: input.catId,
      dedup_key: key,
    },
  ];
}

// A feeder logged a sighting with status `concern` on a cat. Routine. Dedup per
// (cat, the sighting's observed_at) so each distinct concern sighting alerts
// once, but re-running the hook for the same sighting is a no-op.
export function planConcernSightingAlert(
  input: {
    catId: string;
    colonyId: string;
    colonyName: string;
    catName: string;
    reporterName: string;
    observedAt: string; // ISO timestamp of the concern sighting
  },
  existing: ReadonlySet<string> = new Set(),
): AlertSpec[] {
  const key = dedupKey.concern(input.catId, input.observedAt);
  if (existing.has(key)) return [];
  return [
    {
      type: "concern",
      severity: "routine",
      message_key: "alerts.concern",
      message_params: {
        catName: input.catName,
        colonyName: input.colonyName,
        reporterName: input.reporterName,
      },
      colony_id: input.colonyId,
      cat_id: input.catId,
      dedup_key: key,
    },
  ];
}

// ── Time-based planners (fired by the cron sweep) ────────────────────────────

// Per colony, the inputs the feeding-missed rule needs. minutesAfterClose mirrors
// the dashboard: minutes since today's local window close (null = no window),
// computed by the caller with lib/time.minutesAfterWindow so the date math isn't
// re-derived here.
export type FeedingMissedColony = {
  colonyId: string;
  colonyName: string;
  minutesAfterClose: number | null;
  // The org's feeding-missed threshold in hours (alert_settings, default 12).
  // Drives BOTH the message body AND detection: feedingStatus is called with
  // thresholdHours×60 so the per-org setting actually takes effect (no hardcoded
  // 720). The caller passes the row value (fallback DEFAULT_FEEDING_MISSED_HOURS).
  thresholdHours: number;
};

// Plan feeding_missed alerts for one org's colonies for the local day `localDate`
// (org-tz "today", from lib/time.todayInTz). Reuses latestFedByColony +
// feedingStatus verbatim: a colony is missed only when the latest event today is
// not "fed" AND the window closed ≥ threshold ago. Dedup per (colony, localDate)
// so the 15-min cron re-scan can't re-alert the same colony the same day.
export function planFeedingMissedAlerts(
  input: {
    colonies: FeedingMissedColony[];
    events: FeedEvent[];
    localDate: string; // org-tz calendar date, e.g. "2026-06-09"
  },
  existing: ReadonlySet<string> = new Set(),
): AlertSpec[] {
  const latest = latestFedByColony(input.events);
  const specs: AlertSpec[] = [];
  for (const c of input.colonies) {
    const event = latest.get(c.colonyId);
    const fed = event?.fed === true;
    const status = feedingStatus(
      {
        fed,
        minutesAfterClose: c.minutesAfterClose,
      },
      c.thresholdHours * 60,
    );
    if (status !== "missed") continue;
    const key = dedupKey.feedingMissed(c.colonyId, input.localDate);
    if (existing.has(key)) continue;
    specs.push({
      type: "feeding_missed",
      severity: "routine",
      message_key: "alerts.feeding_missed",
      message_params: { colonyName: c.colonyName, hours: c.thresholdHours },
      colony_id: c.colonyId,
      dedup_key: key,
    });
  }
  return specs;
}

// Per cat, the inputs the not-seen/concern scan needs — exactly what
// concernCandidate consumes, plus the names for the message.
export type NotSeenCat = {
  catId: string;
  colonyId: string;
  colonyName: string;
  catName: string;
  status: string;
  sightings: ConcernSighting[];
  reviews?: ConcernReview[];
};

// The observed_at that anchors the not-seen dedup key: the START of the current
// non-seen streak (the OLDEST consecutive non-seen sighting at the head of the
// newest-first run). Anchoring on the streak start — not "now" — means the SAME
// ongoing absence keeps one stable key across daily re-scans (so it alerts
// once), while a fresh seen→not-seen flip starts a new streak and re-raises.
function notSeenStreakStart(sightings: ConcernSighting[]): string | null {
  const ordered = sightings
    .slice()
    .sort(
      (a, b) =>
        new Date(b.observed_at).getTime() - new Date(a.observed_at).getTime(),
    );
  let start: string | null = null;
  for (const s of ordered) {
    if (s.status !== "seen") start = s.observed_at;
    else break;
  }
  return start;
}

// Plan not_seen alerts for one org's cats. Reuses concernCandidate verbatim for
// detection (not-seen-days OR repeated-not-seen, with the same threshold/review
// re-raise logic the dashboard uses) and concernReasonKey to pick the body
// variant — NO threshold or date math is re-derived here. `concern`-reason
// candidates are intentionally SKIPPED: a live concern sighting already alerts
// via the event hook (planConcernSightingAlert); the cron owns only the
// time-based not-seen rules. Monitoring candidates are skipped too (a caretaker
// is already watching). Dedup per (cat, streakStart) keeps one alert per absence.
export function planNotSeenAlerts(
  input: {
    cats: NotSeenCat[];
    thresholds?: ConcernThresholds;
    now: Date;
  },
  existing: ReadonlySet<string> = new Set(),
): AlertSpec[] {
  const specs: AlertSpec[] = [];
  for (const cat of input.cats) {
    const flag = concernCandidate({
      status: cat.status,
      sightings: cat.sightings,
      reviews: cat.reviews ?? [],
      thresholds: input.thresholds ?? {},
      now: input.now,
    });
    // Not a candidate, already being monitored, or a live "concern" flag (owned
    // by the event hook) → the cron raises nothing.
    if (flag === null) continue;
    if (flag.monitoring) continue;
    if (flag.reason === "concern") continue;

    const streakStart = notSeenStreakStart(cat.sightings);
    if (streakStart === null) continue; // defensive: a non-seen run must exist
    const key = dedupKey.notSeen(cat.catId, streakStart);
    if (existing.has(key)) continue;

    specs.push({
      type: "not_seen",
      severity: "routine",
      message_key: "alerts.not_seen",
      message_params: {
        catName: cat.catName,
        colonyName: cat.colonyName,
        count: flag.count,
        // The renderer selects the body sub-key from reason, mirroring
        // concernReasonKey() (the content design). Stored raw for the locale to
        // resolve; we expose the reason verbatim from cat-concern.
        reason: flag.reason,
      },
      colony_id: cat.colonyId,
      cat_id: cat.catId,
      dedup_key: key,
    });
  }
  return specs;
}

// Re-export so the renderer (next card) can reuse the SAME reason→key mapping
// the concern queue uses, rather than re-deriving the not_seen body sub-key.
export { concernReasonKey };
