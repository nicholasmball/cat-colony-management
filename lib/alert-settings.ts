// Pure parse + bounds validation for the org's three alert thresholds, shared by
// the /app/alerts form action. Side-effect-free so every boundary is unit-tested
// in isolation (mirrors lib/feeding-status & lib/cat-concern): no DB, no I/O.
//
// The DB column type is `smallint not null` with table defaults 7/3/12
// (supabase/migrations/0002_domain.sql). We reject anything that isn't a whole
// number inside the documented range so a tampered/JS-off submit can never write
// a nonsense threshold; the action turns an !ok result into an `?error=` redirect.

import {
  DEFAULT_NOT_SEEN_DAYS,
  DEFAULT_REPEATED_NOT_SEEN,
} from "./cat-concern.ts";

// No-row fallback for the feeding-missed threshold (hours). The 7/3 not-seen
// defaults are reused from cat-concern so there's one source of truth; the 12h
// default lives here because feeding-status owns minutes (MISSED_AFTER_MIN=720).
export const DEFAULT_FEEDING_MISSED_HOURS = 12;

// Re-export the not-seen defaults so callers needing the full effective-default
// triple (e.g. the page prefill) import them from one place.
export { DEFAULT_NOT_SEEN_DAYS, DEFAULT_REPEATED_NOT_SEEN };

// Inclusive bounds, matching the design doc + the smallint storage.
export const ALERT_BOUNDS = {
  not_seen_days: { min: 1, max: 60 },
  repeated_not_seen: { min: 1, max: 10 },
  feeding_missed_hours: { min: 1, max: 72 },
} as const;

export type AlertSettingsField = keyof typeof ALERT_BOUNDS;

export type AlertSettingsValue = {
  not_seen_days: number;
  repeated_not_seen: number;
  feeding_missed_hours: number;
};

export type ParseAlertSettingsResult =
  | { ok: true; value: AlertSettingsValue }
  | { ok: false; field: AlertSettingsField };

// Parse one raw form value (string | null) into a bounded integer for `field`.
// Returns null when it isn't a whole number within range — empty, blank,
// non-numeric, decimals ("7.5"), zero, negatives and out-of-bounds all fail.
function parseBounded(
  raw: string | number | null | undefined,
  field: AlertSettingsField,
): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (text === "") return null;
  // Whole-number only: no decimals, no exponent, no leading +/sign tricks.
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  if (!Number.isInteger(n)) return null;
  const { min, max } = ALERT_BOUNDS[field];
  if (n < min || n > max) return null;
  return n;
}

// Validate all three fields in declaration order (so the first bad field is the
// one reported). On success returns the snake_case row ready to upsert.
export function parseAlertSettings(input: {
  notSeenDays: string | number | null | undefined;
  repeatedNotSeen: string | number | null | undefined;
  feedingMissedHours: string | number | null | undefined;
}): ParseAlertSettingsResult {
  const not_seen_days = parseBounded(input.notSeenDays, "not_seen_days");
  if (not_seen_days === null) return { ok: false, field: "not_seen_days" };

  const repeated_not_seen = parseBounded(
    input.repeatedNotSeen,
    "repeated_not_seen",
  );
  if (repeated_not_seen === null)
    return { ok: false, field: "repeated_not_seen" };

  const feeding_missed_hours = parseBounded(
    input.feedingMissedHours,
    "feeding_missed_hours",
  );
  if (feeding_missed_hours === null)
    return { ok: false, field: "feeding_missed_hours" };

  return {
    ok: true,
    value: { not_seen_days, repeated_not_seen, feeding_missed_hours },
  };
}
