// Types for the offline write outbox (Phase 2). NO DOM, NO IndexedDB import — the
// queue logic (outbox.ts), backoff (backoff.ts) and flush orchestration (sync.ts)
// are all PURE and operate over the `Store` interface below, so they can be
// node:test-ed with an in-memory fake. The real IndexedDB adapter (idb-store.ts)
// is the only place that touches `indexedDB`, and it's deliberately not unit-tested.

// The three Phase-1 writes that may be queued offline. Each maps 1:1 to a JSON
// route (feeding → /api/feedings, cat_report → /api/cats/report, incident →
// /api/incidents) that already accepts a client-supplied UUID and returns
// { ok, id, duplicate? }, which is what makes replay idempotent.
export type OutboxKind = "feeding" | "cat_report" | "incident";

// Lifecycle of a queued item:
//   pending  → not yet sent (the initial state, and where it returns after a
//              network failure so a later flush retries it)
//   syncing  → a flush has picked it up and a POST is in flight
//   synced   → the server accepted it (2xx) or reported it as a duplicate; the
//              write is durably persisted server-side
//   failed   → it will NOT succeed on a blind retry without intervention:
//              either a validation rejection (4xx) or an auth-expiry that needs
//              the user to sign in again. A failed item is NEVER dropped.
export type OutboxState = "pending" | "syncing" | "synced" | "failed";

export type OutboxItem = {
  // The client UUID minted by the form — this is the SAME id the route upserts
  // onConflict:"id", so it doubles as the outbox primary key AND the idempotency
  // key. Replaying the same localId can never create a duplicate record.
  localId: string;
  kind: OutboxKind;
  url: string;
  body: unknown;
  state: OutboxState;
  attempts: number;
  lastError?: string;
  createdAt: number;
};

// Storage-agnostic persistence contract for the queue. The pure logic depends
// only on this; idb-store.ts supplies the real implementation and outbox.test.ts
// supplies an in-memory fake. All methods are async to match IndexedDB.
export interface Store {
  getAll(): Promise<OutboxItem[]>;
  put(item: OutboxItem): Promise<void>;
  delete(localId: string): Promise<void>;
}
