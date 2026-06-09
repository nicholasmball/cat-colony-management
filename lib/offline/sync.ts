// PURE flush orchestration for the offline outbox. NO DOM, NO IndexedDB, NO
// fetch, NO supabase import — every side-effecting dependency is INJECTED via
// `SyncDeps`, so the whole state matrix (success / duplicate / 401 / 400 /
// network / backoff gating) is node:test-able with fakes (see sync.test.ts).
//
// The thin browser caller (components/offline-sync.tsx) wires the real deps:
// the IndexedDB store, `fetch` as `post`, and the browser supabase client's
// refreshSession/session helpers.

import {
  list,
  markSyncing,
  markSynced,
  markFailed,
  markPendingRetry,
} from "./outbox.ts";
import { isDue } from "./backoff.ts";
import type { Store } from "./types.ts";

// The normalized result of POSTing one item. The caller (offline-sync.tsx) maps a
// real `fetch` Response into this; a thrown network error is surfaced as
// `kind: "network"` so we never confuse "server said no" with "couldn't reach
// the server". This keeps sync.ts free of any fetch/Response coupling.
export type PostResult =
  | { kind: "ok"; duplicate?: boolean }
  | { kind: "auth" } // 401 / unauthorized — needs sign-in
  | { kind: "validation"; error?: string } // other 4xx — won't pass on retry
  | { kind: "network" }; // offline / fetch threw — retry later

export type SyncDeps = {
  store: Store;
  // Posts the item's body to its url and returns a normalized PostResult.
  post: (url: string, body: unknown) => Promise<PostResult>;
  // Refreshes the auth session before posting if it's near expiry. Returns false
  // if the refresh failed (e.g. the refresh token is also expired) → treated as
  // an auth failure so the item is parked as `failed`, never dropped.
  refreshSession: () => Promise<boolean>;
  // Injected clock for deterministic backoff gating.
  now: () => number;
};

export type FlushOutcome = {
  attempted: number;
  synced: number;
  failed: number;
  pending: number; // left pending for a later retry (network)
  skipped: number; // not due yet (backoff) or not eligible
};

// Reason strings are i18n KEYS, not user copy — the (Phase-4) UI resolves them.
// Kept here so the failure semantics live with the logic that sets them.
export const FAILED_REASON_AUTH = "offline.failedAuth";
export const FAILED_REASON_VALIDATION = "offline.failedValidation";
export const PENDING_REASON_NETWORK = "offline.pendingNetwork";

// Flush the queue once. For each DUE item (pending + backoff-elapsed):
//   markSyncing → refreshSession (once, up front) → post →
//     ok / duplicate     → markSynced
//     auth (401/refresh) → markFailed(AUTH)        — NEVER dropped
//     validation (4xx)   → markFailed(VALIDATION)  — won't pass on retry
//     network            → markPendingRetry        — stays pending, retried later
//
// refreshSession runs ONCE before the loop: if it fails we still attempt the
// posts (a still-valid access token may work), but the per-item auth handling
// below is the real guard. This avoids hammering refresh per item.
export async function flush(deps: SyncDeps): Promise<FlushOutcome> {
  const { store, post, refreshSession, now } = deps;
  const outcome: FlushOutcome = {
    attempted: 0,
    synced: 0,
    failed: 0,
    pending: 0,
    skipped: 0,
  };

  const items = await list(store);
  const due = items.filter((i) => isDue(i, now()));
  outcome.skipped = items.length - due.length;
  if (due.length === 0) return outcome;

  // Refresh once up front so a near-expiry token doesn't 401 every item. A
  // failed refresh is non-fatal here — a still-valid access token may post fine,
  // and a genuine 401 is caught per-item below.
  await refreshSession();

  for (const item of due) {
    outcome.attempted += 1;
    await markSyncing(store, item.localId);

    let result: PostResult;
    try {
      result = await post(item.url, item.body);
    } catch {
      // A thrown error from `post` is treated as a transient network failure.
      result = { kind: "network" };
    }

    switch (result.kind) {
      case "ok":
        await markSynced(store, item.localId);
        outcome.synced += 1;
        break;
      case "auth":
        await markFailed(store, item.localId, FAILED_REASON_AUTH);
        outcome.failed += 1;
        break;
      case "validation":
        await markFailed(
          store,
          item.localId,
          result.error || FAILED_REASON_VALIDATION,
        );
        outcome.failed += 1;
        break;
      case "network":
        await markPendingRetry(store, item.localId, PENDING_REASON_NETWORK);
        outcome.pending += 1;
        break;
    }
  }

  return outcome;
}
