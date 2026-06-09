// public/sw-kill.js — the rollback weapon (Phase 0 of offline-first).
//
// This is a SELF-UNREGISTERING service worker. Deploying it as the active SW
// evicts ANY previously-installed service worker and ALL caches for every
// returning user, then force-reloads their open tabs so the page drops the old
// controller. It is the single source of truth for "make a returning user clean
// again" and lands BEFORE any caching SW exists, so the panic button is always
// available.
//
// Plain JS in /public — not bundled, no build step — so it is dead-simple and
// auditable. components/sw-register.tsx registers this file when the kill flag
// is set (NEXT_PUBLIC_SW_KILL) or as the eviction path.

// Activate immediately, without waiting for existing clients to close.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // 1. Delete every cache this origin owns.
      for (const key of await caches.keys()) {
        await caches.delete(key);
      }
      // 2. Unregister this (and thereby the previously-active) service worker.
      await self.registration.unregister();
      // 3. Force a clean reload of every open tab so it drops the controller and
      //    fetches fresh from the network — back to the SW-less baseline.
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) {
        client.navigate(client.url);
      }
    })(),
  );
});
