// PURE retry/backoff math for the outbox. NO DOM, NO time source captured here —
// callers pass `now` so it's deterministic in tests. Used by sync.ts to decide
// which pending/failed items are due for another send.

import type { OutboxItem } from "./types.ts";

// Capped exponential backoff keyed on attempts already made:
//   attempt 0 → 0ms (send immediately the first time)
//   attempt 1 → BASE          (1× 5s   = 5s)
//   attempt 2 → BASE * 2      (10s)
//   attempt 3 → BASE * 4      (20s)
//   …doubling, clamped to MAX_DELAY_MS (5 min).
// Keeping it pure + small means the curve is exactly testable.
export const BASE_DELAY_MS = 5_000;
export const MAX_DELAY_MS = 5 * 60_000;

export function backoffDelayMs(attempts: number): number {
  if (attempts <= 0) return 0;
  const delay = BASE_DELAY_MS * 2 ** (attempts - 1);
  return Math.min(delay, MAX_DELAY_MS);
}

// Whether an item is due for a (re)send attempt at time `now`.
//
// Only `pending` items are due — a `syncing` item is already in flight, a
// `synced` item is done, and a `failed` item needs intervention (auth re-login
// or a code fix) rather than a blind timed retry, so it is NOT auto-retried here.
//
// Gating uses createdAt + the most recent attempt's backoff window. We don't
// store a separate lastAttemptAt (keeps the item shape lean per the spec); since
// markSyncing bumps attempts and the item's createdAt anchors it, a fresh item
// (attempts 0) is always immediately due, and retries are spaced by the curve
// relative to createdAt — monotonic and good enough for a foreground flush.
export function isDue(item: OutboxItem, now: number): boolean {
  if (item.state !== "pending") return false;
  const dueAt = item.createdAt + backoffDelayMs(item.attempts);
  return now >= dueAt;
}
