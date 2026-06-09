"use client";

import { useEffect } from "react";
import { getStore, runFlush } from "@/lib/offline/client";

// App-wide flush driver for the offline outbox (Phase 2). Renders nothing.
//
// This is the iOS-safe baseline: NO service worker / Background Sync yet (Phase
// 3). We flush the queue on the foreground triggers the browser actually gives a
// PWA reliably: regaining connectivity (`online`), the tab becoming visible
// (`visibilitychange` → visible), and on mount/load. The actual flush — single-
// flight, with the real deps and a post-flush change notification — lives in
// lib/offline/client.ts (runFlush), shared with the Phase-4 sync indicator and
// the Retry button, so there's exactly one flusher.
export function OfflineSync() {
  useEffect(() => {
    if (!getStore()) return; // IndexedDB unavailable → no queue to flush.

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
