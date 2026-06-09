import { test } from "node:test";
import assert from "node:assert/strict";
import {
  backoffDelayMs,
  isDue,
  BASE_DELAY_MS,
  MAX_DELAY_MS,
} from "./backoff.ts";
import type { OutboxItem } from "./types.ts";

function item(over: Partial<OutboxItem> = {}): OutboxItem {
  return {
    localId: "a",
    kind: "feeding",
    url: "/api/feedings",
    body: {},
    state: "pending",
    attempts: 0,
    createdAt: 0,
    ...over,
  };
}

test("backoffDelayMs: 0 attempts → 0 (send immediately)", () => {
  assert.equal(backoffDelayMs(0), 0);
});

test("backoffDelayMs: capped exponential by attempts", () => {
  assert.equal(backoffDelayMs(1), BASE_DELAY_MS);
  assert.equal(backoffDelayMs(2), BASE_DELAY_MS * 2);
  assert.equal(backoffDelayMs(3), BASE_DELAY_MS * 4);
});

test("backoffDelayMs: clamps to MAX_DELAY_MS", () => {
  assert.equal(backoffDelayMs(100), MAX_DELAY_MS);
});

test("isDue: a fresh pending item (attempts 0) is immediately due", () => {
  assert.equal(isDue(item({ attempts: 0, createdAt: 0 }), 0), true);
});

test("isDue: a retried item is NOT due before its backoff window", () => {
  const it = item({ attempts: 1, createdAt: 1_000 });
  // window = createdAt + BASE_DELAY_MS
  assert.equal(isDue(it, 1_000 + BASE_DELAY_MS - 1), false);
  assert.equal(isDue(it, 1_000 + BASE_DELAY_MS), true);
});

test("isDue: non-pending states are never due (syncing/synced/failed skipped)", () => {
  assert.equal(isDue(item({ state: "syncing" }), 9e9), false);
  assert.equal(isDue(item({ state: "synced" }), 9e9), false);
  // failed is intentionally NOT auto-retried by backoff — needs intervention.
  assert.equal(isDue(item({ state: "failed" }), 9e9), false);
});
