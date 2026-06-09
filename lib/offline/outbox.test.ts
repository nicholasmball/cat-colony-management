import { test } from "node:test";
import assert from "node:assert/strict";
import {
  enqueue,
  list,
  markSyncing,
  markSynced,
  markFailed,
  markPendingRetry,
  remove,
  countByState,
} from "./outbox.ts";
import type { OutboxItem, Store } from "./types.ts";

// In-memory fake Store — the whole point of the Store interface is that the queue
// logic is storage-agnostic, so we test it without IndexedDB.
function fakeStore(seed: OutboxItem[] = []): Store {
  const map = new Map<string, OutboxItem>(seed.map((i) => [i.localId, i]));
  return {
    async getAll() {
      // Return clones so tests can't accidentally mutate stored rows in place.
      return [...map.values()].map((i) => ({ ...i }));
    },
    async put(item) {
      map.set(item.localId, { ...item });
    },
    async delete(localId) {
      map.delete(localId);
    },
  };
}

test("enqueue: adds a pending item with attempts 0", async () => {
  const store = fakeStore();
  const item = await enqueue(store, {
    localId: "a",
    kind: "feeding",
    url: "/api/feedings",
    body: { fed: true },
    createdAt: 100,
  });
  assert.equal(item.state, "pending");
  assert.equal(item.attempts, 0);
  const all = await list(store);
  assert.equal(all.length, 1);
  assert.equal(all[0].localId, "a");
});

test("list: returns items oldest-first (FIFO by createdAt)", async () => {
  const store = fakeStore();
  await enqueue(store, {
    localId: "late",
    kind: "incident",
    url: "/api/incidents",
    body: {},
    createdAt: 300,
  });
  await enqueue(store, {
    localId: "early",
    kind: "feeding",
    url: "/api/feedings",
    body: {},
    createdAt: 100,
  });
  const all = await list(store);
  assert.deepEqual(
    all.map((i) => i.localId),
    ["early", "late"],
  );
});

test("markSyncing: sets syncing and bumps attempts", async () => {
  const store = fakeStore();
  await enqueue(store, {
    localId: "a",
    kind: "feeding",
    url: "/api/feedings",
    body: {},
    createdAt: 0,
  });
  await markSyncing(store, "a");
  const [item] = await list(store);
  assert.equal(item.state, "syncing");
  assert.equal(item.attempts, 1);
  await markSyncing(store, "a");
  const [again] = await list(store);
  assert.equal(again.attempts, 2);
});

test("markSynced: sets synced and clears lastError", async () => {
  const store = fakeStore([
    {
      localId: "a",
      kind: "feeding",
      url: "/api/feedings",
      body: {},
      state: "pending",
      attempts: 1,
      lastError: "boom",
      createdAt: 0,
    },
  ]);
  await markSynced(store, "a");
  const [item] = await list(store);
  assert.equal(item.state, "synced");
  assert.equal(item.lastError, undefined);
});

test("markFailed: sets failed with a reason and keeps the item (never dropped)", async () => {
  const store = fakeStore();
  await enqueue(store, {
    localId: "a",
    kind: "incident",
    url: "/api/incidents",
    body: {},
    createdAt: 0,
  });
  await markFailed(store, "a", "offline.failedAuth");
  const all = await list(store);
  assert.equal(all.length, 1, "failed item must remain in the queue");
  assert.equal(all[0].state, "failed");
  assert.equal(all[0].lastError, "offline.failedAuth");
});

test("markPendingRetry: returns item to pending with a reason", async () => {
  const store = fakeStore([
    {
      localId: "a",
      kind: "feeding",
      url: "/api/feedings",
      body: {},
      state: "syncing",
      attempts: 1,
      createdAt: 0,
    },
  ]);
  await markPendingRetry(store, "a", "offline.pendingNetwork");
  const [item] = await list(store);
  assert.equal(item.state, "pending");
  assert.equal(item.lastError, "offline.pendingNetwork");
});

test("remove: hard-deletes an item", async () => {
  const store = fakeStore();
  await enqueue(store, {
    localId: "a",
    kind: "feeding",
    url: "/api/feedings",
    body: {},
    createdAt: 0,
  });
  await remove(store, "a");
  assert.equal((await list(store)).length, 0);
});

test("countByState: counts items per state", async () => {
  const store = fakeStore([
    {
      localId: "a",
      kind: "feeding",
      url: "/api/feedings",
      body: {},
      state: "pending",
      attempts: 0,
      createdAt: 0,
    },
    {
      localId: "b",
      kind: "incident",
      url: "/api/incidents",
      body: {},
      state: "failed",
      attempts: 1,
      createdAt: 1,
    },
    {
      localId: "c",
      kind: "cat_report",
      url: "/api/cats/report",
      body: {},
      state: "pending",
      attempts: 0,
      createdAt: 2,
    },
  ]);
  assert.equal(await countByState(store, "pending"), 2);
  assert.equal(await countByState(store, "failed"), 1);
  assert.equal(await countByState(store, "synced"), 0);
});

test("transitions are no-ops on a missing item (removed mid-flush)", async () => {
  const store = fakeStore();
  // None of these should throw even though "ghost" isn't present.
  await markSyncing(store, "ghost");
  await markSynced(store, "ghost");
  await markFailed(store, "ghost", "x");
  await markPendingRetry(store, "ghost", "x");
  assert.equal((await list(store)).length, 0);
});
