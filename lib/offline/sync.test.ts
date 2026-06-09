import { test } from "node:test";
import assert from "node:assert/strict";
import {
  flush,
  FAILED_REASON_AUTH,
  FAILED_REASON_VALIDATION,
  PENDING_REASON_NETWORK,
  type PostResult,
  type SyncDeps,
} from "./sync.ts";
import { list } from "./outbox.ts";
import { BASE_DELAY_MS } from "./backoff.ts";
import type { OutboxItem, Store } from "./types.ts";

function fakeStore(seed: OutboxItem[] = []): Store {
  const map = new Map<string, OutboxItem>(seed.map((i) => [i.localId, i]));
  return {
    async getAll() {
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

function pending(over: Partial<OutboxItem> = {}): OutboxItem {
  return {
    localId: "a",
    kind: "feeding",
    url: "/api/feedings",
    body: { fed: true },
    state: "pending",
    attempts: 0,
    createdAt: 0,
    ...over,
  };
}

// Build deps with a fixed clock and a programmable post; refreshSession defaults
// to succeeding. `now` is high so fresh items are always due unless told otherwise.
function deps(
  store: Store,
  post: (url: string, body: unknown) => Promise<PostResult>,
  over: Partial<SyncDeps> = {},
): SyncDeps {
  return {
    store,
    post,
    refreshSession: async () => true,
    now: () => 1_000_000,
    ...over,
  };
}

test("success (2xx) → markSynced", async () => {
  const store = fakeStore([pending()]);
  const out = await flush(deps(store, async () => ({ kind: "ok" })));
  const [item] = await list(store);
  assert.equal(item.state, "synced");
  assert.equal(out.synced, 1);
  assert.equal(out.attempted, 1);
});

test("duplicate:true → markSynced (idempotent replay)", async () => {
  const store = fakeStore([pending()]);
  await flush(deps(store, async () => ({ kind: "ok", duplicate: true })));
  const [item] = await list(store);
  assert.equal(item.state, "synced");
});

test("auth (401 / refresh failed) → markFailed, item NOT dropped", async () => {
  const store = fakeStore([pending()]);
  const out = await flush(deps(store, async () => ({ kind: "auth" })));
  const all = await list(store);
  assert.equal(all.length, 1, "auth-failed item must never be dropped");
  assert.equal(all[0].state, "failed");
  assert.equal(all[0].lastError, FAILED_REASON_AUTH);
  assert.equal(out.failed, 1);
});

test("validation (other 4xx) → markFailed (won't pass on retry)", async () => {
  const store = fakeStore([pending()]);
  const out = await flush(
    deps(store, async () => ({ kind: "validation", error: "Bad type." })),
  );
  const [item] = await list(store);
  assert.equal(item.state, "failed");
  assert.equal(item.lastError, "Bad type.");
  assert.equal(out.failed, 1);
});

test("validation with no message falls back to the i18n key", async () => {
  const store = fakeStore([pending()]);
  await flush(deps(store, async () => ({ kind: "validation" })));
  const [item] = await list(store);
  assert.equal(item.lastError, FAILED_REASON_VALIDATION);
});

test("network error → stays pending (retried later), attempts bumped", async () => {
  const store = fakeStore([pending()]);
  const out = await flush(deps(store, async () => ({ kind: "network" })));
  const [item] = await list(store);
  assert.equal(item.state, "pending");
  assert.equal(item.attempts, 1, "markSyncing bumped attempts");
  assert.equal(item.lastError, PENDING_REASON_NETWORK);
  assert.equal(out.pending, 1);
});

test("post throwing is treated as a network failure (stays pending)", async () => {
  const store = fakeStore([pending()]);
  await flush(
    deps(store, async () => {
      throw new Error("fetch failed");
    }),
  );
  const [item] = await list(store);
  assert.equal(item.state, "pending");
});

test("backoff gating: a not-yet-due retry is skipped, not posted", async () => {
  // attempts 1, createdAt 0 → due at BASE_DELAY_MS. now is just before that.
  const store = fakeStore([pending({ attempts: 1, createdAt: 0 })]);
  let posted = false;
  const out = await flush(
    deps(
      store,
      async () => {
        posted = true;
        return { kind: "ok" };
      },
      { now: () => BASE_DELAY_MS - 1 },
    ),
  );
  assert.equal(posted, false, "must not post a not-yet-due item");
  assert.equal(out.attempted, 0);
  assert.equal(out.skipped, 1);
  const [item] = await list(store);
  assert.equal(item.state, "pending");
});

test("flush processes only due items and counts the rest as skipped", async () => {
  const store = fakeStore([
    pending({ localId: "due", attempts: 0, createdAt: 0 }),
    pending({ localId: "waiting", attempts: 1, createdAt: 1_000_000 }),
  ]);
  const out = await flush(deps(store, async () => ({ kind: "ok" })));
  assert.equal(out.attempted, 1);
  assert.equal(out.synced, 1);
  assert.equal(out.skipped, 1);
});

test("failed items are not auto-retried by flush (state guard)", async () => {
  const store = fakeStore([pending({ state: "failed", attempts: 1 })]);
  let posted = false;
  const out = await flush(
    deps(store, async () => {
      posted = true;
      return { kind: "ok" };
    }),
  );
  assert.equal(posted, false);
  assert.equal(out.attempted, 0);
});

test("refreshSession is called once before posting", async () => {
  const store = fakeStore([
    pending({ localId: "a", createdAt: 0 }),
    pending({ localId: "b", createdAt: 1 }),
  ]);
  let refreshCalls = 0;
  await flush(
    deps(store, async () => ({ kind: "ok" }), {
      refreshSession: async () => {
        refreshCalls += 1;
        return true;
      },
    }),
  );
  assert.equal(refreshCalls, 1, "refresh once per flush, not per item");
});

test("empty / all-skipped queue does not call refreshSession", async () => {
  const store = fakeStore([]);
  let refreshed = false;
  const out = await flush(
    deps(store, async () => ({ kind: "ok" }), {
      refreshSession: async () => {
        refreshed = true;
        return true;
      },
    }),
  );
  assert.equal(refreshed, false);
  assert.equal(out.attempted, 0);
});

test("mixed batch: success + auth-fail + network in one flush", async () => {
  const store = fakeStore([
    pending({ localId: "ok", url: "/api/feedings", createdAt: 0 }),
    pending({ localId: "auth", url: "/api/incidents", createdAt: 1 }),
    pending({ localId: "net", url: "/api/cats/report", createdAt: 2 }),
  ]);
  const out = await flush(
    deps(store, async (url) => {
      if (url === "/api/incidents") return { kind: "auth" };
      if (url === "/api/cats/report") return { kind: "network" };
      return { kind: "ok" };
    }),
  );
  assert.equal(out.synced, 1);
  assert.equal(out.failed, 1);
  assert.equal(out.pending, 1);
  const byId = new Map((await list(store)).map((i) => [i.localId, i]));
  assert.equal(byId.get("ok")?.state, "synced");
  assert.equal(byId.get("auth")?.state, "failed");
  assert.equal(byId.get("net")?.state, "pending");
});
