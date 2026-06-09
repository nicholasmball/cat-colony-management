// PURE queue operations over an injected `Store` (lib/offline/types.ts). NO
// IndexedDB, NO DOM — every function here is node:test-able with an in-memory
// fake Store (see outbox.test.ts). The real persistence lives in idb-store.ts.
//
// State transitions are deliberately one-directional helpers (markSyncing /
// markSynced / markFailed) so sync.ts reads as a small state machine and the
// transitions are testable in isolation.

import type { OutboxItem, OutboxKind, OutboxState, Store } from "./types.ts";

// Add a new write to the queue in the `pending` state. The localId is the form's
// client UUID (also the idempotency key); attempts starts at 0.
export async function enqueue(
  store: Store,
  item: {
    localId: string;
    kind: OutboxKind;
    url: string;
    body: unknown;
    createdAt: number;
  },
): Promise<OutboxItem> {
  const row: OutboxItem = {
    localId: item.localId,
    kind: item.kind,
    url: item.url,
    body: item.body,
    state: "pending",
    attempts: 0,
    createdAt: item.createdAt,
  };
  await store.put(row);
  return row;
}

// All queued items, oldest first — flush order is FIFO so writes replay in the
// order the user made them.
export async function list(store: Store): Promise<OutboxItem[]> {
  const all = await store.getAll();
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

// Internal: load one item by id (or undefined if it was removed mid-flush).
async function find(
  store: Store,
  localId: string,
): Promise<OutboxItem | undefined> {
  const all = await store.getAll();
  return all.find((i) => i.localId === localId);
}

// Mark an item as in-flight and bump its attempt counter. The attempt is counted
// at the START of a send so backoff gating reflects "tries made" even if the
// send never resolves (e.g. the tab closed). No-op if the item is gone.
export async function markSyncing(
  store: Store,
  localId: string,
): Promise<void> {
  const item = await find(store, localId);
  if (!item) return;
  await store.put({
    ...item,
    state: "syncing",
    attempts: item.attempts + 1,
  });
}

// Mark an item as durably persisted server-side (2xx or duplicate:true). We KEEP
// the row (state="synced") rather than deleting it here, so the Phase-4 sync-status
// UI can briefly show "saved". A separate prune step (or removeSynced) clears them.
export async function markSynced(store: Store, localId: string): Promise<void> {
  const item = await find(store, localId);
  if (!item) return;
  await store.put({ ...item, state: "synced", lastError: undefined });
}

// Mark an item as failed-needs-intervention (validation 4xx or auth-expiry). It
// stays in the queue with a reason — NEVER dropped — so it's visible and, for the
// auth case, retryable once the user signs in.
export async function markFailed(
  store: Store,
  localId: string,
  reason: string,
): Promise<void> {
  const item = await find(store, localId);
  if (!item) return;
  await store.put({ ...item, state: "failed", lastError: reason });
}

// Return an item to `pending` after a transient network failure so a later flush
// retries it. attempts was already bumped by markSyncing; we just record why.
export async function markPendingRetry(
  store: Store,
  localId: string,
  reason: string,
): Promise<void> {
  const item = await find(store, localId);
  if (!item) return;
  await store.put({ ...item, state: "pending", lastError: reason });
}

// Hard-remove an item (e.g. pruning a synced row).
export async function remove(store: Store, localId: string): Promise<void> {
  await store.delete(localId);
}

// Count items in a given state — used by the flush summary and the Phase-4 badge.
export async function countByState(
  store: Store,
  state: OutboxState,
): Promise<number> {
  const all = await store.getAll();
  return all.filter((i) => i.state === state).length;
}
