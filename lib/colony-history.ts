// Pure, dependency-free helpers for the colony detail page's two read-only
// history sections — the recent feeding-update timeline and the recent-incident
// timeline — plus the "Last fed" indicator. Mirrors lib/cat-history.ts: kept
// free of React/Supabase/Next so the row-shaping rules (flag derivation,
// overflow detection, batched who-resolution, last-fed-from-rows, null
// tolerance) are unit-testable and the page stays a thin renderer.

import { attributionEmail } from "./cat-report.ts";
import { statusTone, type CatStatusTone } from "./cat-display.ts";

// The list bound shown per section. We fetch ONE more than this (LIMIT 11) so a
// full page of 11 tells us there are older rows to flag without a second query.
export const HISTORY_LIMIT = 10;

// The optional flags a feeding update can carry, in render order.
export type FeedingFlag = "problem" | "food_issue" | "danger";

// ── Raw row shapes (exactly what the two bounded SELECTs return) ─────────────
export type RawFeedingEvent = {
  fed: boolean;
  problem: boolean;
  food_issue: boolean;
  danger: boolean;
  notes: string | null;
  feeder_id: string | null;
  observed_at: string;
};

export type RawIncident = {
  id: string;
  type: string;
  status: string;
  cat_id: string | null;
  urgency_level_id: string | null;
  reported_by: string | null;
  occurred_at: string;
};

// ── View-models the page renders (who already resolved to an email or null) ──
export type FeedingRow = {
  fed: boolean;
  // Tone for the fed/not-fed pill — "good" when fed, "bad" when not (icon+word
  // accompanies it in the UI; never colour alone).
  tone: CatStatusTone;
  // Only the flags that are set, in a stable order, so the page maps straight
  // to badges without re-checking each boolean.
  flags: FeedingFlag[];
  observedAt: string;
  // Resolved email, or null when there's no feeder OR it doesn't resolve
  // (deleted/departed volunteer) — the page then renders NO name (GDPR-safe).
  who: string | null;
  notes: string | null;
};

export type IncidentRow = {
  id: string;
  type: string;
  status: string;
  catId: string | null;
  urgencyLevelId: string | null;
  occurredAt: string;
  // Resolved reporter email or null — rendered name-less when null.
  who: string | null;
};

export type HistorySection<Row> = {
  rows: Row[]; // ≤ HISTORY_LIMIT rows, newest-first (input order preserved)
  hasMore: boolean; // true when the source returned more than HISTORY_LIMIT
};

// The "Last fed" summary derived from the ordered feeding rows. `fedAt` is the
// observed_at of the newest row whose `fed` is true, or null when the colony
// has never been recorded as fed (no rows, or only not-fed rows).
export type LastFed = {
  fedAt: string | null;
};

// Collect the distinct, non-null user ids referenced across BOTH history lists
// (feeding feeder_id + incident reported_by) into one set, so the caller folds
// them into its single getUserById-per-distinct-id batch (no N+1) and shares
// one Map<uuid,email> across both sections.
export function collectUserIds(
  feedings: readonly RawFeedingEvent[],
  incidents: readonly RawIncident[],
): string[] {
  const ids = new Set<string>();
  for (const f of feedings) if (f.feeder_id) ids.add(f.feeder_id);
  for (const i of incidents) if (i.reported_by) ids.add(i.reported_by);
  return [...ids];
}

// Shared bound+overflow rule: keep the first HISTORY_LIMIT rows (rows arrive
// newest-first) and flag overflow when the source returned more. Fetching
// LIMIT 11 makes `hasMore` exact for the common case without a count query.
function bound<Raw, Row>(
  rows: readonly Raw[],
  map: (row: Raw) => Row,
): HistorySection<Row> {
  return {
    rows: rows.slice(0, HISTORY_LIMIT).map(map),
    hasMore: rows.length > HISTORY_LIMIT,
  };
}

// Derive the set flags for a feeding row, in stable render order.
function feedingFlags(row: RawFeedingEvent): FeedingFlag[] {
  const flags: FeedingFlag[] = [];
  if (row.problem) flags.push("problem");
  if (row.food_issue) flags.push("food_issue");
  if (row.danger) flags.push("danger");
  return flags;
}

// Shape the feeding timeline: derive the fed tone + the set flags, resolve each
// feeder via the shared email map (missing/unresolved → null, rendered
// name-less), pass notes through.
export function buildFeedingSection(
  rows: readonly RawFeedingEvent[],
  emails: Map<string, string>,
): HistorySection<FeedingRow> {
  return bound(rows, (f) => ({
    fed: f.fed,
    tone: statusTone(f.fed ? "active" : "missing"),
    flags: feedingFlags(f),
    observedAt: f.observed_at,
    who: attributionEmail(f.feeder_id, emails),
    notes: f.notes,
  }));
}

// Shape the incident timeline: pass status/type/links through, resolve the
// reporter through the same email map (null → rendered name-less).
export function buildIncidentSection(
  rows: readonly RawIncident[],
  emails: Map<string, string>,
): HistorySection<IncidentRow> {
  return bound(rows, (i) => ({
    id: i.id,
    type: i.type,
    status: i.status,
    catId: i.cat_id,
    urgencyLevelId: i.urgency_level_id,
    occurredAt: i.occurred_at,
    who: attributionEmail(i.reported_by, emails),
  }));
}

// Derive the "Last fed" indicator from the ordered (newest-first) feeding rows:
// the observed_at of the newest row marked fed, or null when never fed. We scan
// rather than read [0] because the newest event may be a not-fed correction.
export function lastFedFromRows(rows: readonly RawFeedingEvent[]): LastFed {
  for (const r of rows) {
    if (r.fed) return { fedAt: r.observed_at };
  }
  return { fedAt: null };
}
