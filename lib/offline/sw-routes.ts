// PURE URL-classification logic for the service worker's runtime-caching rules.
// NO DOM, NO Serwist import, NO `self` — just string/URL reasoning, so the
// "which rule does this request fall under?" decision is node:test-able
// (see sw-routes.test.ts) and the SW source (app/sw.ts) stays thin glue that
// only wires these predicates to Serwist strategies.
//
// The whole point of factoring this out: a caching mis-classification is exactly
// how a SW bricks users (e.g. cache-first an RSC payload → stale shell after a
// deploy). Keeping the boundaries here, exhaustively tested, makes the risky
// decision auditable.

// The three Phase-1/2 write endpoints. These MUST be NetworkOnly with NO SW
// queue: the Phase-2 IndexedDB outbox already owns offline writes + replay, so
// a SW Background-Sync queue would DOUBLE-queue them. Kept as a constant so the
// SW and the tests share one source of truth.
export const WRITE_ROUTES = [
  "/api/feedings",
  "/api/cats/report",
  "/api/incidents",
] as const;

// A POST to one of the 3 write routes. Matched by pathname only (ignores query/
// origin) so it's robust to absolute vs relative request URLs. Method is checked
// by the caller's Serwist route (registerRoute matches method) — this predicate
// is the pathname half.
export function isWriteRoute(pathname: string): boolean {
  return (WRITE_ROUTES as readonly string[]).includes(pathname);
}

// The LIMITED read-cache scope approved in the plan (A+D): ONLY last-viewed
// colony + cat GET *document* pages, PLUS the per-colony feed page and the Today
// page, get StaleWhileRevalidate — NOT the whole org, NOT dashboards/alerts/the
// colonies index (those must always be fresh), NOT API/data routes.
//
// Matches:
//   /app/colonies/<id>                      (a colony page)
//   /app/colonies/<id>/cats/<catId>         (a cat page)
//   /app/colonies/<id>/feed                 (the feed-update page — a GET form)
//   /app/today                              (the Today landing page)
// Excludes (returns false): the colonies index, the dashboard, alerts, any
// */edit, */new, */report, */incidents, */schedules sub-pages (write/action
// surfaces — never served stale), and anything outside the above.
//
// `new` and `report` are RESERVED route segments (the create/report write
// surfaces — /app/colonies/new, /app/colonies/<id>/cats/new and /cats/report),
// never real colony/cat ids, so they are explicitly excluded from the id slot —
// otherwise CAT_PAGE would wrongly match /cats/report (a write page) and serve a
// stale form. Real ids are UUIDs, so this exclusion can never reject a genuine page.
// The same ID guard is reused for the feed regex so /app/colonies/new/feed (an
// impossible-but-defensive case) can't be cached.
//
// HONEST LIMITATION: this only makes offline navigation work for pages the user
// actually OPENED while ONLINE earlier today — SWR caches on first network hit.
// A cold start straight to a never-opened colony/cat/feed page while offline gets
// offline.html, not the page. Whole-org prefetch was REJECTED (too much data /
// stale-cat risk). The cache is BOUNDED (40 entries / 24h) so it self-evicts and
// never hoards the org.
const ID = "(?!new$|report$)[^/]+";
const COLONY_PAGE = new RegExp(`^/app/colonies/${ID}$`);
const CAT_PAGE = new RegExp(`^/app/colonies/${ID}/cats/${ID}$`);
const FEED_PAGE = new RegExp(`^/app/colonies/${ID}/feed$`);
const TODAY_PAGE = /^\/app\/today$/;

export function isReadCacheablePage(pathname: string): boolean {
  return (
    COLONY_PAGE.test(pathname) ||
    CAT_PAGE.test(pathname) ||
    FEED_PAGE.test(pathname) ||
    TODAY_PAGE.test(pathname)
  );
}

// Is this a navigation/data request under the app shell (/app/**) that must be
// NetworkFirst — i.e. we never serve a stale app build/RSC that a fresh deploy
// has invalidated, but an OFFLINE user still falls back to the cached shell.
// True for everything under /app EXCEPT the narrow read-cacheable pages above
// (those get the more aggressive SWR rule instead).
export function isAppShellPath(pathname: string): boolean {
  return pathname.startsWith("/app") && !isReadCacheablePage(pathname);
}
