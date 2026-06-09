/// <reference lib="webworker" />
//
// app/sw.ts — the REAL caching service worker (Phase 3 of offline-first).
// Compiled by @serwist/next (next.config.ts → withSerwist) into public/sw.js.
//
// CRITICAL SAFETY POSTURE (why this file is so conservative):
//   • A bad SW bricks returning installed users. So this SW ships DISABLED by
//     default — when NEXT_PUBLIC_SW_ENABLED is not "true", withSerwist runs with
//     `disable:true` and NO public/sw.js is emitted at all, AND the Phase-0
//     register gate (components/sw-register.tsx) never registers it. Two locks.
//   • public/sw-kill.js (Phase 0) remains the supreme rollback weapon and is
//     entirely independent of this file.
//
// Runtime-caching rules are deliberately minimal and live next to the pure,
// node:tested predicates in lib/offline/sw-routes.ts so the risky "which rule?"
// decision is auditable:
//   • /app/** navigations + RSC  → NetworkFirst (never serve stale app JS/RSC
//                                   that a fresh deploy invalidated; offline
//                                   falls back to the cached shell).
//   • last-viewed colony/cat GET → StaleWhileRevalidate (the LIMITED approved
//                                   read-cache scope — NOT the whole org).
//   • the 3 write routes         → NetworkOnly, NO SW queue. The Phase-2
//                                   IndexedDB outbox owns offline writes + replay;
//                                   a SW Background-Sync queue would DOUBLE-queue
//                                   them. Background Sync is intentionally
//                                   DEFERRED (see note at the write rule below).
//
// OFFLINE FALLBACK: when a document (top-level navigation) request can't be
// satisfied — offline AND not in any cache — Serwist serves the precached
// /public/offline.html as a last resort (the `fallbacks` block below). The
// matcher is scoped to `request.destination === "document"` ONLY, so online
// 4xx/5xx responses and non-document requests are NOT masked by the fallback.

import {
  Serwist,
  NetworkFirst,
  NetworkOnly,
  StaleWhileRevalidate,
  type PrecacheEntry,
  type SerwistGlobalConfig,
  type RouteMatchCallbackOptions,
} from "serwist";
import {
  isAppShellPath,
  isReadCacheablePage,
  isWriteRoute,
} from "@/lib/offline/sw-routes";

// @serwist/next injects the precache manifest (the static build assets it emits)
// into `self.__SW_MANIFEST` at build time. Typed here per Serwist's docs.
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

// Match helpers: classify by URL pathname using the PURE predicates. Method is
// matched per-route below (Serwist routes can scope by HTTP method).
const matchAppShell = ({ url, request }: RouteMatchCallbackOptions) =>
  request.mode === "navigate" ||
  request.destination === "document" ||
  // RSC / Next data fetches under the shell must also be NetworkFirst.
  url.pathname.startsWith("/_next/") ||
  isAppShellPath(url.pathname);

const matchReadPage = ({ url }: RouteMatchCallbackOptions) =>
  isReadCacheablePage(url.pathname);

const matchWriteRoute = ({ url }: RouteMatchCallbackOptions) =>
  isWriteRoute(url.pathname);

const serwist = new Serwist({
  // Precache ONLY the static app shell / build assets Serwist emits. Versioned/
  // revisioned caches are handled by Serwist's precache strategy.
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: { cleanupOutdatedCaches: true },

  // UPDATE STRATEGY — skipWaiting + clientsClaim, chosen deliberately:
  // a new SW activates immediately and takes control, so a returning user is
  // never trapped on a stale shell after a deploy. This is SAFE here precisely
  // because /app/** + RSC are NetworkFirst (the fresh build's JS/RSC are fetched
  // from the network, not served from an old precache), and the kill-switch can
  // evict everything if a deploy ever goes wrong. The alternative (a manual
  // "update available" prompt) would risk users sitting on a stale controller.
  skipWaiting: true,
  clientsClaim: true,

  // Distinct cacheId so our caches are namespaced and the kill-switch's blanket
  // caches.delete() (Phase 0) still wipes them.
  cacheId: "scot-offline",

  runtimeCaching: [
    // 1) Write routes: NetworkOnly, NO Background-Sync queue. The Phase-2 outbox
    //    already persists failed offline writes in IndexedDB and replays them on
    //    reconnect/foreground (components/offline-sync.tsx), keyed by the form's
    //    client UUID for idempotency. Adding a SW BackgroundSyncQueue here would
    //    replay the SAME writes a second time → double-queue. Background Sync is
    //    therefore INTENTIONALLY DEFERRED; the outbox is the single owner of
    //    offline writes. (If ever wired, it must dedupe against the outbox.)
    {
      matcher: matchWriteRoute,
      method: "POST",
      handler: new NetworkOnly(),
    },

    // 2) Last-viewed colony/cat GET pages: StaleWhileRevalidate — the limited,
    //    approved read-cache scope. Small, time-bounded cache so we never hoard
    //    the whole org and stale entries expire.
    {
      matcher: matchReadPage,
      method: "GET",
      handler: new StaleWhileRevalidate({
        cacheName: "scot-read-pages",
        plugins: [],
      }),
    },

    // 3) Everything else under the app shell (navigations + RSC + _next assets):
    //    NetworkFirst with a short timeout, falling back to cache so an OFFLINE
    //    user still gets the shell. Never serves stale app JS/RSC while online.
    {
      matcher: matchAppShell,
      handler: new NetworkFirst({
        cacheName: "scot-app-shell",
        networkTimeoutSeconds: 3,
      }),
    },
  ],

  // OFFLINE FALLBACK: last-resort document response when the network fails and
  // nothing is cached. Document-only matcher so online errors and sub-resource
  // requests are never masked. offline.html is precached via the public/**
  // manifest glob (no extra precacheEntries needed).
  fallbacks: {
    entries: [
      {
        url: "/offline.html",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();
