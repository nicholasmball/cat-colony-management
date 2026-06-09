"use client";

import { useEffect } from "react";
import { swMode, envFlag } from "@/lib/offline/sw-flags";

// Drives service-worker behaviour from two build-time env flags, using the pure
// swMode() helper (lib/offline/sw-flags.ts) for all branching. Renders nothing.
//
// PHASE 0 (this commit) is the SAFETY FOUNDATION: there is NO caching service
// worker yet — the only SW file in the repo is the self-unregistering
// /sw-kill.js. This component therefore never registers a caching SW here; the
// "register" branch below is intentionally SW-free and is where Phase 3 will
// wire the real /sw.js.
//
// Flags (NEXT_PUBLIC_* so they're inlined at build; a change needs a redeploy):
//   NEXT_PUBLIC_SW_ENABLED — turn the real offline SW on (Phase 3).
//   NEXT_PUBLIC_SW_KILL    — emergency: unregister everything + clear caches.
export function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const mode = swMode({
      enabled: envFlag(process.env.NEXT_PUBLIC_SW_ENABLED),
      kill: envFlag(process.env.NEXT_PUBLIC_SW_KILL),
    });

    // Unregister every currently-registered service worker. Used by both the
    // "off" mode and — in Phase 0 only — the "register" mode (since no real SW
    // exists yet, "register" must still leave the app genuinely SW-free).
    const unregisterAll = async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((r) => r.unregister()));
    };

    switch (mode) {
      case "kill":
        // Register the self-unregistering SW: it clears all caches, unregisters
        // the prior SW, and force-reloads. This is the rollback weapon.
        void navigator.serviceWorker.register("/sw-kill.js");
        break;

      case "register":
        // PHASE 0: the real caching SW does not exist yet. We deliberately do
        // NOT register a caching SW here — instead we keep the app SW-free by
        // unregistering anything present. Phase 3 will replace this branch with
        // `navigator.serviceWorker.register("/sw.js")`.
        void unregisterAll();
        break;

      case "off":
        // Ensure no service worker is registered.
        void unregisterAll();
        break;
    }
  }, []);

  return null;
}
