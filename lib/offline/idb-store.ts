// The REAL IndexedDB-backed `Store` (lib/offline/types.ts). This is the thin
// ADAPTER layer — it is the ONLY file that touches `indexedDB`, and it is
// deliberately NOT unit-tested: all the queue/backoff/flush logic that we DO test
// lives in the pure libs (outbox.ts, backoff.ts, sync.ts) and runs over the Store
// interface, so this file carries no branching worth a node:test. Browser-only.

import type { OutboxItem, Store } from "./types.ts";

const DB_NAME = "scot-offline";
const DB_VERSION = 1;
const STORE_NAME = "outbox"; // one object store, keyed by localId

// Is IndexedDB usable here? Guards SSR (no `indexedDB`) and locked-down browsers
// (private mode in some engines throws on open). Callers fall back to a no-op
// when this is false so the app never crashes for the lack of a queue.
export function isIdbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "localId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Build a Store over IndexedDB. Each call opens a fresh connection per op for
// simplicity (the queue is low-volume — a handful of field writes); correctness
// over micro-optimisation. Returns null when IndexedDB isn't available so the
// caller can degrade gracefully.
export function createIdbStore(): Store | null {
  if (!isIdbAvailable()) return null;

  return {
    async getAll() {
      const db = await openDb();
      try {
        const tx = db.transaction(STORE_NAME, "readonly");
        const all = await promisify(
          tx.objectStore(STORE_NAME).getAll() as IDBRequest<OutboxItem[]>,
        );
        return all ?? [];
      } finally {
        db.close();
      }
    },
    async put(item: OutboxItem) {
      const db = await openDb();
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        await promisify(tx.objectStore(STORE_NAME).put(item));
      } finally {
        db.close();
      }
    },
    async delete(localId: string) {
      const db = await openDb();
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        await promisify(tx.objectStore(STORE_NAME).delete(localId));
      } finally {
        db.close();
      }
    },
  };
}
