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
//   • last-viewed colony/cat/feed → StaleWhileRevalidate (the LIMITED approved
//     + Today GET pages           read-cache scope, A+D — NOT the whole org).
//                                   Versioned per build + bounded 40/24h.
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
  ExpirationPlugin,
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

// Per-build revision (injected by next.config.ts → env.NEXT_PUBLIC_SW_BUILD_REV;
// the short commit SHA on Vercel, a dev marker locally). The read-page SWR cache
// is namespaced by it so a fresh deploy starts with a CLEAN cache and the
// activate handler below evicts the old revision — a previous build's RSC
// payloads can never be served by the new shell.
const BUILD_REV = process.env.NEXT_PUBLIC_SW_BUILD_REV ?? "dev";
const READ_PAGES_CACHE = `scot-read-pages-${BUILD_REV}`;

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

    // 2) Last-viewed colony/cat GET pages + the per-colony feed page + Today
    //    (A+D): StaleWhileRevalidate — the limited, approved read-cache scope.
    //    These are the surfaces a feeder re-opens in the field, so caching them
    //    on the online visit lets them re-render offline. (RSC ?_rsc= variants
    //    match too — matchReadPage classifies on the query-stripped pathname.)
    //    The cache is VERSIONED per build (READ_PAGES_CACHE) so a deploy gets a
    //    fresh namespace + the activate handler evicts the prior revision, and
    //    BOUNDED by ExpirationPlugin (40 entries / 24h) so it self-evicts and
    //    never hoards the org. purgeOnQuotaError lets it drop under storage
    //    pressure rather than wedging the SW.
    {
      matcher: matchReadPage,
      method: "GET",
      handler: new StaleWhileRevalidate({
        cacheName: READ_PAGES_CACHE,
        plugins: [
          new ExpirationPlugin({
            maxEntries: 40,
            maxAgeSeconds: 86400,
            purgeOnQuotaError: true,
          }),
        ],
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

// OLD-REVISION CLEANUP: on activate, delete any prior read-page cache namespace
// (scot-read-pages-*) that is NOT the current build's. The versioned cacheName
// alone would leave stale-revision caches lingering until quota pressure; this
// reclaims them immediately on the deploy that supersedes them. Scoped to the
// read-pages prefix so it never touches the app-shell or precache, and registered
// BEFORE addEventListeners() so it runs alongside Serwist's own activate logic.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (name) =>
              name.includes("scot-read-pages-") && !name.endsWith(BUILD_REV),
          )
          .map((name) => caches.delete(name)),
      );
    })(),
  );
});

serwist.addEventListeners();
