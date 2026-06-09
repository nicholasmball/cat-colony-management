// Pure, locale-aware relative time ("2 hours ago", "há 2 horas") for the
// notification feed. Built on Intl.RelativeTimeFormat so the wording + plural
// rules come from the platform, never from hand-rolled strings — that keeps it
// out of the messages catalog and correct in both en and pt.
//
// PURE by design (mirrors lib/feeding-status & lib/alert-engine): `now` is PASSED
// IN, never read from Date.now() inside, so every case is deterministic and
// unit-testable. The caller (a server component) supplies `new Date()` once.

// Largest-fitting unit, descending. Each step is the number of THIS unit's
// seconds; we pick the coarsest unit whose span the elapsed time reaches.
const DIVISIONS: { unit: Intl.RelativeTimeFormatUnit; seconds: number }[] = [
  { unit: "year", seconds: 60 * 60 * 24 * 365 },
  { unit: "month", seconds: 60 * 60 * 24 * 30 },
  { unit: "week", seconds: 60 * 60 * 24 * 7 },
  { unit: "day", seconds: 60 * 60 * 24 },
  { unit: "hour", seconds: 60 * 60 },
  { unit: "minute", seconds: 60 },
];

// Render the gap between `from` and `now` as a locale-aware relative phrase.
// Anything under a minute (incl. tiny future skew from clock drift) collapses to
// "now"/"agora" via the numeric "second" path at value 0. Past times are
// negative ("ago"); a future `from` reads "in …" — both handled by the sign.
export function relativeTime(from: Date, now: Date, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const elapsedSeconds = Math.round((from.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(elapsedSeconds);

  // Under a minute → "now" (RelativeTimeFormat with numeric:"auto" maps 0
  // seconds to the idiomatic "now"/"agora").
  if (abs < 60) return rtf.format(0, "second");

  for (const { unit, seconds } of DIVISIONS) {
    if (abs >= seconds) {
      const value = Math.round(elapsedSeconds / seconds);
      return rtf.format(value, unit);
    }
  }
  // Unreachable (abs >= 60 always matches "minute"), but keeps the return total.
  return rtf.format(0, "second");
}
