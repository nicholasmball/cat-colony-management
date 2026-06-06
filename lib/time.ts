// Timezone-aware "today" / day-boundary helpers.
//
// The whole app must decide what counts as "today" (and when a feeding window
// has lapsed) in the ORGANISATION's local zone, never the server's UTC clock.
// These helpers operate on UTC instants internally; the IANA `tz` only governs
// where the local day boundaries fall, so the maths stays correct across DST
// transitions and regardless of where the server runs.
//
// Dependency-free: built on Intl.DateTimeFormat with a fixed timeZone.

// Offset (local wall-clock minus UTC), in ms, for a zone AT a given instant.
// Positive east of UTC. Derived by formatting the instant in the zone and
// reading back the wall-clock parts.
function tzOffsetMs(tz: string, instant: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, number> = {};
  for (const part of dtf.formatToParts(instant)) {
    if (part.type !== "literal") map[part.type] = Number(part.value);
  }
  // Some engines render midnight as hour "24" — normalise to 0.
  const hour = map.hour % 24;
  const asUtc = Date.UTC(
    map.year,
    map.month - 1,
    map.day,
    hour,
    map.minute,
    map.second,
  );
  return asUtc - instant.getTime();
}

// The UTC instant corresponding to a given LOCAL wall-clock time in `tz`.
// Two-pass to land on the correct side of a DST transition: guess using the
// wall-clock as if it were UTC, correct by the offset at that guess, then
// re-read the offset at the corrected instant and apply it.
function wallClockToUtc(
  tz: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  let offset = tzOffsetMs(tz, new Date(guess));
  offset = tzOffsetMs(tz, new Date(guess - offset));
  return new Date(guess - offset);
}

// "2026-06-05" — the local calendar date in `tz` for the given instant.
export function todayInTz(tz: string, now: Date = new Date()): string {
  // en-CA renders ISO-style YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function ymd(date: string | Date | undefined, tz: string): [number, number, number] {
  const iso =
    date == null
      ? todayInTz(tz)
      : typeof date === "string"
        ? date
        : todayInTz(tz, date);
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m, d];
}

// UTC instants bounding a local day: [startUtc, endUtc) where endUtc is the
// start of the next local day. Suitable for `>= startUtc and < endUtc` queries
// against UTC timestamptz columns. Correct on 23h/25h DST-transition days.
export function dayRangeInTz(
  tz: string,
  date?: string | Date,
): { startUtc: Date; endUtc: Date } {
  const [y, m, d] = ymd(date, tz);
  const startUtc = wallClockToUtc(tz, y, m, d);
  // Next calendar day via pure UTC-date arithmetic (DST-agnostic), then resolve
  // that local midnight back to its UTC instant.
  const next = new Date(Date.UTC(y, m - 1, d) + 86_400_000);
  const endUtc = wallClockToUtc(
    tz,
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
  );
  return { startUtc, endUtc };
}

// Minutes elapsed since today's local feeding-window close. Negative if the
// window hasn't closed yet today. Drives the "feeding missed = 12h after the
// window" alert threshold. `windowEndLocal` is "HH:MM" or "HH:MM:SS".
export function minutesAfterWindow(
  windowEndLocal: string,
  tz: string,
  now: Date = new Date(),
): number {
  const [y, m, d] = ymd(now, tz);
  const [h, min, s = 0] = windowEndLocal.split(":").map(Number);
  const closeUtc = wallClockToUtc(tz, y, m, d, h, min, s);
  return Math.round((now.getTime() - closeUtc.getTime()) / 60_000);
}

// Is `tz` a valid IANA zone? Used to validate org-settings input server-side.
export function isValidTimeZone(tz: string): boolean {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
