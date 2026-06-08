// Pure, side-effect-free detection for the "cats of concern" review queue.
//
// Given a cat's sightings (any order), the org's alert thresholds and any
// caretaker review rows, decide whether the cat is a *current* review candidate
// and WHY — so the colony page and cat detail can render a reason chip + group
// the cat without a second query or any stored flag. Mirrors lib/feeding-status:
// no Date.now() inside, time is passed in (`now`) so tests are deterministic.
//
// Rules (from the MVP Requirements + the missing-cat design, step 4):
//   * concern            — the latest sighting's status is `concern`.
//   * not_seen_days      — no `seen` sighting within not_seen_days (default 7)
//                          AND the latest sighting is `not_seen`/`concern`.
//   * repeated_not_seen  — the latest repeated_not_seen (default 3) sightings are
//                          all non-seen (no `seen` among them).
// Re-raise (time-anchored): a review (ignored/monitoring) silences signals OLDER
// than it. The cat is NOT a current candidate if the latest review's created_at
// is newer than the most recent triggering signal (the latest non-seen
// sighting's observed_at). A NEW non-seen/concern sighting dated after the
// latest review re-raises it. `monitoring` keeps the cat visible (Monitoring
// group); `ignored` clears it until a fresh signal.
// Never auto-anything: this only SUGGESTS review; status changes are a human act.

export const DEFAULT_NOT_SEEN_DAYS = 7;
export const DEFAULT_REPEATED_NOT_SEEN = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

// A cat in this status belongs to the New queue (caretaker confirm/reject), not
// the concern queue — never flag it here regardless of its sightings.
const NEW_UNCONFIRMED = "new_unconfirmed";

export type SightingStatus = "seen" | "not_seen" | "concern";
export type ConcernReviewOutcome = "ignored" | "monitoring";
export type ConcernReason = "concern" | "not_seen_days" | "repeated_not_seen";

export type ConcernSighting = {
  status: SightingStatus;
  observed_at: string; // ISO timestamp
};

export type ConcernReview = {
  outcome: ConcernReviewOutcome;
  created_at: string; // ISO timestamp
};

export type ConcernThresholds = {
  not_seen_days?: number | null;
  repeated_not_seen?: number | null;
};

export type ConcernCandidate = {
  reason: ConcernReason;
  // The number that drives the chip: days not seen (not_seen_days), the run
  // length of consecutive non-seen sightings (repeated_not_seen), or 0 (concern).
  count: number;
  // True when the most recent review is `monitoring` and still applies — the cat
  // stays visible but in the distinct Monitoring sub-group rather than "new".
  monitoring: boolean;
};

// A non-seen signal is anything that isn't a confirmed sighting.
function isNonSeen(status: SightingStatus): boolean {
  return status !== "seen";
}

function ts(iso: string): number {
  return new Date(iso).getTime();
}

// Whole days between two instants (floored), never negative.
function daysBetween(earlier: number, later: number): number {
  return Math.max(0, Math.floor((later - earlier) / DAY_MS));
}

// The core decision. Returns null when the cat is NOT a current candidate
// (no sightings / new_unconfirmed / seen recently / silenced by a newer review),
// otherwise the reason + count + whether it's under active monitoring.
export function concernCandidate({
  status,
  sightings,
  reviews = [],
  thresholds = {},
  now,
}: {
  status: string;
  sightings: ConcernSighting[];
  reviews?: ConcernReview[];
  thresholds?: ConcernThresholds;
  now: Date;
}): ConcernCandidate | null {
  // A new_unconfirmed cat belongs to the New queue, never the concern queue.
  if (status === NEW_UNCONFIRMED) return null;
  // Zero sightings ever → no baseline → not a candidate.
  if (sightings.length === 0) return null;

  const notSeenDays =
    thresholds.not_seen_days != null && thresholds.not_seen_days > 0
      ? thresholds.not_seen_days
      : DEFAULT_NOT_SEEN_DAYS;
  const repeatedNotSeen =
    thresholds.repeated_not_seen != null && thresholds.repeated_not_seen > 0
      ? thresholds.repeated_not_seen
      : DEFAULT_REPEATED_NOT_SEEN;

  // Work on a newest-first copy so input order doesn't matter (callers may pass
  // either order). We never mutate the caller's array.
  const ordered = sightings
    .slice()
    .sort((a, b) => ts(b.observed_at) - ts(a.observed_at));
  const latest = ordered[0];
  const nowMs = now.getTime();

  // ── Determine the reason (latest-signal wins for chip semantics) ─────────────
  let reason: ConcernReason | null = null;
  let count = 0;

  if (latest.status === "concern") {
    reason = "concern";
    count = 0;
  } else {
    // not_seen_days: the most recent `seen` is older than the window (or never),
    // and the latest sighting is itself non-seen.
    const lastSeen = ordered.find((s) => s.status === "seen");
    const daysSinceSeen = lastSeen
      ? daysBetween(ts(lastSeen.observed_at), nowMs)
      : daysBetween(ts(ordered[ordered.length - 1].observed_at), nowMs);
    const noRecentSeen = !lastSeen || daysSinceSeen >= notSeenDays;
    if (isNonSeen(latest.status) && noRecentSeen) {
      reason = "not_seen_days";
      count = daysSinceSeen;
    } else if (isNonSeen(latest.status)) {
      // repeated_not_seen: the latest run of consecutive non-seen sightings is
      // at least the threshold long (no `seen` interrupting the run).
      let run = 0;
      for (const s of ordered) {
        if (isNonSeen(s.status)) run += 1;
        else break;
      }
      if (run >= repeatedNotSeen) {
        reason = "repeated_not_seen";
        count = run;
      }
    }
  }

  if (reason === null) return null;

  // ── Time-anchored re-raise: silence signals older than the latest review ─────
  // The triggering signal's time is the latest non-seen sighting's observed_at
  // (for `concern` that's the latest sighting itself).
  const latestNonSeen = ordered.find((s) => isNonSeen(s.status));
  const signalAt = latestNonSeen
    ? ts(latestNonSeen.observed_at)
    : ts(latest.observed_at);
  const latestReview = reviews
    .slice()
    .sort((a, b) => ts(b.created_at) - ts(a.created_at))[0];

  if (latestReview && ts(latestReview.created_at) >= signalAt) {
    // The review is newer than the signal → it's been handled.
    // `ignored` clears it entirely; `monitoring` keeps it visible (Monitoring).
    if (latestReview.outcome === "ignored") return null;
    return { reason, count, monitoring: true };
  }

  // Fresh signal (or no review): a current candidate, not (yet) monitoring.
  return { reason, count, monitoring: false };
}

// Short reason text for the candidate chip and the cat-detail context line. Pure
// so the wording is unit-tested and the page just renders it next to an icon
// (never colour/icon-alone — the words carry the meaning). e.g. "Not seen 9
// days", "Not seen 4 times", "Flagged: concern".
export function concernReasonText(candidate: {
  reason: ConcernReason;
  count: number;
}): string {
  switch (candidate.reason) {
    case "concern":
      return "Flagged: concern";
    case "not_seen_days":
      return `Not seen ${candidate.count} ${candidate.count === 1 ? "day" : "days"}`;
    case "repeated_not_seen":
      return `Not seen ${candidate.count} ${candidate.count === 1 ? "time" : "times"} in a row`;
  }
}
