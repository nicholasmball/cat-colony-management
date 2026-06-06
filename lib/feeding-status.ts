// Pure status logic for the "Feeder Today" screen. Side-effect-free so it can be
// unit-tested in isolation and shared between the list and any future summary.
//
// The "missed" threshold matches SCoT's alert default: a colony counts as missed
// only once its feeding window closed at least 12h ago (720 min). Anything sooner
// is still "pending" — never auto-escalate on a window that only just lapsed.

export const MISSED_AFTER_MIN = 720;

export type FeedingStatus = "fed" | "pending" | "missed";

// `fed` always wins. Otherwise, with a known window that closed ≥720 min ago the
// colony is "missed"; before that (or with no window at all) it's "pending".
export function feedingStatus({
  fed,
  minutesAfterClose,
}: {
  fed: boolean;
  minutesAfterClose: number | null;
}): FeedingStatus {
  if (fed) return "fed";
  if (minutesAfterClose != null && minutesAfterClose >= MISSED_AFTER_MIN) {
    return "missed";
  }
  return "pending";
}
