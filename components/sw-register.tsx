"use client";

import { useEffect } from "react";
import { swMode, envFlag } from "@/lib/offline/sw-flags";

// Drives service-worker behaviour from two build-time env flags, using the pure
// swMode() helper (lib/offline/sw-flags.ts) for all branching. Renders nothing.
//
// PHASE 3 wires the REAL caching SW: the "register" branch now registers /sw.js
// (compiled by Serwist from app/sw.ts). This branch is only reached when
// NEXT_PUBLIC_SW_ENABLED === "true" AND the kill flag is off — so the SW ships
// DISABLED by default (the flag is unset in dev/preview/prod until the human
// Deploy gate flips it). Belt-and-braces: when the flag is off, Serwist also
// emits NO public/sw.js (next.config.ts `disable`), so even a stray register
// call would 404. The kill-switch (/sw-kill.js) retains absolute supremacy.
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
        // PHASE 3: register the real caching SW (Serwist-compiled /sw.js). Only
        // reached when NEXT_PUBLIC_SW_ENABLED is true and the kill flag is off.
        // The SW uses skipWaiting + clientsClaim (app/sw.ts), so a new version
        // activates and takes control on next load without trapping the user on a
        // stale shell. If a deploy ever goes wrong, NEXT_PUBLIC_SW_KILL flips this
        // to the "kill" branch above and evicts everything.
        void navigator.serviceWorker.register("/sw.js");
        break;

      case "off":
        // Ensure no service worker is registered.
        void unregisterAll();
        break;
    }
  }, []);

  return null;
}
