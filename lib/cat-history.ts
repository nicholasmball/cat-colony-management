// Pure, dependency-free helpers for the cat detail page's two read-only history
// sections — the sighting timeline and the status-change history. Kept free of
// React/Supabase/Next so the row-shaping rules (overflow detection, "Set to …"
// creation rows, batched who-resolution, null tolerance) are unit-testable and
// the page stays a thin renderer over these view-models.

import { attributionEmail } from "./cat-report.ts";

// The list bound shown per section. We fetch ONE more than this (LIMIT 11) so a
// full page of 11 tells us there are older rows to flag without a second query.
export const HISTORY_LIMIT = 10;

// ── Raw row shapes (exactly what the two bounded SELECTs return) ─────────────
export type RawSighting = {
  status: string;
  observed_at: string;
  feeder_id: string | null;
  note: string | null;
};

export type RawStatusChange = {
  old_status: string | null;
  new_status: string;
  created_at: string;
  changed_by: string | null;
};

// ── View-models the page renders (who already resolved to an email or null) ──
export type SightingRow = {
  status: string;
  observedAt: string;
  // Resolved email, or null when there's no feeder OR it doesn't resolve
  // (deleted/departed volunteer) — the page then renders NO name (GDPR-safe).
  who: string | null;
  note: string | null;
};

export type StatusChangeRow = {
  // When true this is the creation row (old_status was null) → render
  // "Set to <newStatus>", never "null → …".
  isCreation: boolean;
  oldStatus: string | null;
  newStatus: string;
  createdAt: string;
  who: string | null;
};

export type HistorySection<Row> = {
  rows: Row[]; // ≤ HISTORY_LIMIT rows, newest-first (input order preserved)
  hasMore: boolean; // true when the source returned more than HISTORY_LIMIT
};

// Collect the distinct, non-null user ids referenced across BOTH history lists
// into one set, so the caller does exactly ONE getUserById per distinct id (no
// N+1) and builds a single Map<uuid,email> shared by both sections.
export function collectUserIds(
  sightings: readonly RawSighting[],
  statusChanges: readonly RawStatusChange[],
): string[] {
  const ids = new Set<string>();
  for (const s of sightings) if (s.feeder_id) ids.add(s.feeder_id);
  for (const c of statusChanges) if (c.changed_by) ids.add(c.changed_by);
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

// Shape the sighting timeline: resolve each feeder via the shared email map
// (missing/unresolved → null, rendered name-less), pass status/note through.
export function buildSightingSection(
  rows: readonly RawSighting[],
  emails: Map<string, string>,
): HistorySection<SightingRow> {
  return bound(rows, (s) => ({
    status: s.status,
    observedAt: s.observed_at,
    who: attributionEmail(s.feeder_id, emails),
    note: s.note,
  }));
}

// Shape the status-change history: a null old_status marks the creation row
// (renders "Set to <status>"); changed_by resolves through the same email map
// (frequently null for system/alert-engine changes → rendered name-less).
export function buildStatusSection(
  rows: readonly RawStatusChange[],
  emails: Map<string, string>,
): HistorySection<StatusChangeRow> {
  return bound(rows, (c) => ({
    isCreation: c.old_status === null,
    oldStatus: c.old_status,
    newStatus: c.new_status,
    createdAt: c.created_at,
    who: attributionEmail(c.changed_by, emails),
  }));
}
