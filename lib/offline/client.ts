// Browser glue between the PURE offline libs and the real platform: the
// IndexedDB store, `fetch`-based POST that normalizes a Response into a
// PostResult, and a supabase-backed refreshSession. This is a thin ADAPTER (no
// branching worth a node:test beyond what the pure libs already cover); it's the
// seam the forms (offline-fallback enqueue) and components/offline-sync.tsx
// (flush) both call. Browser-only.

import { createClient } from "@/lib/supabase/client";
import { createIdbStore } from "./idb-store.ts";
import type { PostResult } from "./sync.ts";
import type { Store } from "./types.ts";

// Lazily create + memoize the IndexedDB store (null if IndexedDB is unavailable).
let cached: Store | null | undefined;
export function getStore(): Store | null {
  if (cached === undefined) cached = createIdbStore();
  return cached;
}

// True when the browser reports it's offline. `navigator.onLine === false` is the
// only reliable "definitely offline" signal; everything else (true, undefined)
// means "try the network and fall back on a thrown error".
export function isDefinitelyOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

// POST JSON to a route and normalize the outcome into a PostResult for sync.ts.
//   2xx + {ok:true}        → ok (carry duplicate)
//   401                    → auth (needs sign-in)
//   other non-2xx / !ok    → validation (won't pass on a blind retry)
//   thrown (network/offline) → propagates; flush() catches it as a network failure
export async function postJson(
  url: string,
  body: unknown,
): Promise<PostResult> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    duplicate?: boolean;
  };
  if (res.status === 401) return { kind: "auth" };
  if (res.ok && json.ok) return { kind: "ok", duplicate: json.duplicate };
  return { kind: "validation", error: json.error };
}

// Refresh the auth session so a near-expiry token doesn't 401 the flush. Returns
// false if there's no session or the refresh failed (the refresh token is also
// expired) — the caller treats that as "may still 401 per item", and the per-item
// auth handling parks those as failed (never dropped).
export async function refreshSessionSafe(): Promise<boolean> {
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    if (!data.session) return false;
    const { error } = await supabase.auth.refreshSession();
    return !error;
  } catch {
    return false;
  }
}
