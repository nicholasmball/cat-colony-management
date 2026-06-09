"use client";

import { useEffect } from "react";
import { flush } from "@/lib/offline/sync";
import { getStore, postJson, refreshSessionSafe } from "@/lib/offline/client";

// App-wide flush driver for the offline outbox (Phase 2). Renders nothing.
//
// This is the iOS-safe baseline: NO service worker / Background Sync yet (Phase
// 3). We flush the queue on the foreground triggers the browser actually gives a
// PWA reliably: regaining connectivity (`online`), the tab becoming visible
// (`visibilitychange` → visible), and on mount/load. All decision logic lives in
// the pure lib/offline/sync.ts; this component only wires the real deps (the
// IndexedDB store, `fetch` via postJson, supabase refreshSession, Date.now).
export function OfflineSync() {
  useEffect(() => {
    const store = getStore();
    if (!store) return; // IndexedDB unavailable → no queue to flush.

    let running = false;
    const runFlush = async () => {
      if (running) return; // Avoid overlapping flushes from rapid triggers.
      running = true;
      try {
        await flush({
          store,
          post: postJson,
          refreshSession: refreshSessionSafe,
          now: () => Date.now(),
        });
      } catch {
        // A flush failure is non-fatal: items stay queued for the next trigger.
      } finally {
        running = false;
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void runFlush();
    };

    window.addEventListener("online", runFlush);
    document.addEventListener("visibilitychange", onVisible);
    // On mount: drain anything left from a previous session.
    void runFlush();

    return () => {
      window.removeEventListener("online", runFlush);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
