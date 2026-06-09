// PURE display helpers for the Phase-4 sync-status UI. NO DOM, NO IndexedDB —
// these map raw outbox counts / items onto the labels + tones the indicator and
// the per-item list render, so the (fiddly) precedence rules are node:test-able
// in isolation and the components stay thin (polling/DOM only).

import type { OutboxItem, OutboxKind, OutboxState } from "./types.ts";

// Per-state counts the indicator summarises. Mirrors the four OutboxState values
// so callers can build it straight from countByState(store, …).
export type QueueCounts = Record<OutboxState, number>;

// The indicator's tone reuses the app's existing chip vocabulary (the
// good/warn/bad/neutral scale from lib/cat-display). The component maps each
// tone onto the shared chip classes — never colour-alone, always icon + text.
export type QueueTone = "good" | "warn" | "bad" | "neutral";

// What the indicator should show for the queue, independent of connectivity.
// `labelKey` is an i18n key under `offline.*`; `count` feeds its ICU {count}.
export type QueueSummary = {
  labelKey: string;
  tone: QueueTone;
  count: number;
};

// Reduce a list of items to per-state counts (for the indicator + the panel
// heading). Unknown/extra states are ignored so a stray value can't crash.
export function countStates(items: OutboxItem[]): QueueCounts {
  const counts: QueueCounts = {
    pending: 0,
    syncing: 0,
    synced: 0,
    failed: 0,
  };
  for (const item of items) {
    if (item.state in counts) counts[item.state] += 1;
  }
  return counts;
}

// Map per-state counts onto the single indicator line, by PRECEDENCE — the most
// important thing the user needs to know wins:
//   failed  → "N failed"        (bad)    — needs intervention, surfaced first
//   syncing → "syncing…"        (warn)   — a flush is in flight
//   pending → "N pending"       (warn)   — queued, will send
//   else    → "all synced"      (good)   — nothing waiting (synced or empty)
// `count` carries the number relevant to the chosen label (failed/pending), so
// the component can pass it straight to the ICU-pluralised message.
export function summariseQueue(counts: QueueCounts): QueueSummary {
  if (counts.failed > 0) {
    return { labelKey: "offline.failed", tone: "bad", count: counts.failed };
  }
  if (counts.syncing > 0) {
    return { labelKey: "offline.syncing", tone: "warn", count: counts.syncing };
  }
  if (counts.pending > 0) {
    return { labelKey: "offline.pending", tone: "warn", count: counts.pending };
  }
  return { labelKey: "offline.allSynced", tone: "good", count: 0 };
}

// Whether the queue has anything worth showing in the per-item panel at all —
// drives the EmptyState ("all caught up") vs. the list.
export function hasQueueActivity(counts: QueueCounts): boolean {
  return counts.pending + counts.syncing + counts.synced + counts.failed > 0;
}

// Only `failed` items get a manual Retry affordance: pending/syncing are already
// progressing on their own, and a synced item is done. A failed item is the one
// case that needs a human nudge (e.g. after re-signing in), so this gates the
// button per row.
export function isRetryable(item: OutboxItem): boolean {
  return item.state === "failed";
}

// The i18n key for a row's per-state label, under `offline.state.*`. Kept here
// (not inlined in the component) so the state→key mapping is covered by a test.
export function stateLabelKey(state: OutboxState): string {
  return `offline.state.${state}`;
}

// The i18n key for a row's kind label, under `offline.kind.*` (feeding / cat
// report / incident). Pure mapping so a new OutboxKind can't silently render a
// raw enum.
export function kindLabelKey(kind: OutboxKind): string {
  return `offline.kind.${kind}`;
}
