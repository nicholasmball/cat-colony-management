import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countStates,
  summariseQueue,
  hasQueueActivity,
  isRetryable,
  stateLabelKey,
  kindLabelKey,
  type QueueCounts,
} from "./summary.ts";
import type { OutboxItem, OutboxState } from "./types.ts";

function item(state: OutboxState, localId: string = state): OutboxItem {
  return {
    localId,
    kind: "feeding",
    url: "/api/feedings",
    body: {},
    state,
    attempts: 0,
    createdAt: 0,
  };
}

function counts(partial: Partial<QueueCounts>): QueueCounts {
  return { pending: 0, syncing: 0, synced: 0, failed: 0, ...partial };
}

test("countStates: tallies items per state, ignores none", () => {
  const c = countStates([
    item("pending", "a"),
    item("pending", "b"),
    item("failed", "c"),
    item("synced", "d"),
  ]);
  assert.deepEqual(c, { pending: 2, syncing: 0, synced: 1, failed: 1 });
});

test("countStates: empty list → all zero", () => {
  assert.deepEqual(countStates([]), {
    pending: 0,
    syncing: 0,
    synced: 0,
    failed: 0,
  });
});

test("summariseQueue: failed wins over everything (bad tone)", () => {
  const s = summariseQueue(counts({ failed: 2, syncing: 1, pending: 3 }));
  assert.deepEqual(s, { labelKey: "offline.failed", tone: "bad", count: 2 });
});

test("summariseQueue: syncing wins over pending when no failures", () => {
  const s = summariseQueue(counts({ syncing: 1, pending: 4 }));
  assert.deepEqual(s, { labelKey: "offline.syncing", tone: "warn", count: 1 });
});

test("summariseQueue: pending when only pending", () => {
  const s = summariseQueue(counts({ pending: 5 }));
  assert.deepEqual(s, { labelKey: "offline.pending", tone: "warn", count: 5 });
});

test("summariseQueue: all synced (good) when nothing waiting", () => {
  const empty = summariseQueue(counts({}));
  assert.deepEqual(empty, {
    labelKey: "offline.allSynced",
    tone: "good",
    count: 0,
  });
  // synced-only rows still count as "all synced" — nothing is waiting.
  const syncedOnly = summariseQueue(counts({ synced: 3 }));
  assert.equal(syncedOnly.labelKey, "offline.allSynced");
  assert.equal(syncedOnly.tone, "good");
});

test("hasQueueActivity: true with any item, false when wholly empty", () => {
  assert.equal(hasQueueActivity(counts({})), false);
  assert.equal(hasQueueActivity(counts({ synced: 1 })), true);
  assert.equal(hasQueueActivity(counts({ failed: 1 })), true);
});

test("isRetryable: only failed items", () => {
  assert.equal(isRetryable(item("failed")), true);
  assert.equal(isRetryable(item("pending")), false);
  assert.equal(isRetryable(item("syncing")), false);
  assert.equal(isRetryable(item("synced")), false);
});

test("stateLabelKey: namespaced per state", () => {
  assert.equal(stateLabelKey("pending"), "offline.state.pending");
  assert.equal(stateLabelKey("failed"), "offline.state.failed");
});

test("kindLabelKey: namespaced per kind", () => {
  assert.equal(kindLabelKey("feeding"), "offline.kind.feeding");
  assert.equal(kindLabelKey("cat_report"), "offline.kind.cat_report");
  assert.equal(kindLabelKey("incident"), "offline.kind.incident");
});
