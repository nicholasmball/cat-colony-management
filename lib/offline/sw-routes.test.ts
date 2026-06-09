import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WRITE_ROUTES,
  isWriteRoute,
  isReadCacheablePage,
  isAppShellPath,
} from "./sw-routes.ts";

// ── isWriteRoute: the 3 NetworkOnly endpoints (no SW queue) ───────────────────

test("isWriteRoute: the 3 write endpoints match", () => {
  for (const r of WRITE_ROUTES) assert.equal(isWriteRoute(r), true);
});

test("isWriteRoute: other api/app paths do not match", () => {
  assert.equal(isWriteRoute("/api/photos/presign"), false);
  assert.equal(isWriteRoute("/api/health"), false);
  assert.equal(isWriteRoute("/app/colonies/abc"), false);
  // The feed page is a GET document, NOT a write route — POST /api/feedings is.
  assert.equal(isWriteRoute("/app/colonies/abc/feed"), false);
  assert.equal(isWriteRoute("/"), false);
  // Sub-path of a write route is NOT the write route itself.
  assert.equal(isWriteRoute("/api/feedings/123"), false);
});

// ── isReadCacheablePage: ONLY last-viewed colony + cat pages (SWR scope) ──────

test("isReadCacheablePage: a colony page matches", () => {
  assert.equal(isReadCacheablePage("/app/colonies/abc-123"), true);
});

test("isReadCacheablePage: a cat page matches", () => {
  assert.equal(isReadCacheablePage("/app/colonies/abc/cats/cat-9"), true);
});

test("isReadCacheablePage: the per-colony feed page matches (A+D)", () => {
  assert.equal(isReadCacheablePage("/app/colonies/abc/feed"), true);
});

test("isReadCacheablePage: the Today page matches (A+D)", () => {
  assert.equal(isReadCacheablePage("/app/today"), true);
});

test("isReadCacheablePage: RSC query string is invariant (classify by pathname)", () => {
  // Next appends ?_rsc=… to RSC navigations. The SW classifies on the
  // query-stripped pathname, so a feed RSC fetch must classify the same as the
  // bare page — otherwise an RSC payload would slip into a different rule.
  assert.equal(
    isReadCacheablePage(
      new URL("https://x/app/colonies/abc/feed?_rsc=1").pathname,
    ),
    true,
  );
  assert.equal(
    isReadCacheablePage(new URL("https://x/app/today?_rsc=1").pathname),
    true,
  );
});

test("isReadCacheablePage: index + write/action sub-pages are EXCLUDED", () => {
  // The colonies index must stay fresh (list of colonies changes).
  assert.equal(isReadCacheablePage("/app/colonies"), false);
  // Write/action surfaces — never serve stale.
  assert.equal(isReadCacheablePage("/app/colonies/abc/edit"), false);
  assert.equal(isReadCacheablePage("/app/colonies/abc/feed/edit"), false);
  assert.equal(isReadCacheablePage("/app/colonies/new"), false);
  assert.equal(isReadCacheablePage("/app/colonies/abc/cats/new"), false);
  assert.equal(isReadCacheablePage("/app/colonies/abc/cats/report"), false);
  assert.equal(isReadCacheablePage("/app/colonies/abc/cats/cat-9/edit"), false);
  assert.equal(isReadCacheablePage("/app/colonies/abc/incidents"), false);
  assert.equal(isReadCacheablePage("/app/colonies/abc/schedules/s1"), false);
});

test("isReadCacheablePage: dashboards/other app pages are EXCLUDED", () => {
  assert.equal(isReadCacheablePage("/app/dashboard"), false);
  assert.equal(isReadCacheablePage("/app/alerts"), false);
  assert.equal(isReadCacheablePage("/app"), false);
});

// ── isAppShellPath: NetworkFirst scope (everything /app except SWR pages) ─────

test("isAppShellPath: app pages that are NOT read-cacheable are NetworkFirst", () => {
  assert.equal(isAppShellPath("/app"), true);
  assert.equal(isAppShellPath("/app/dashboard"), true);
  assert.equal(isAppShellPath("/app/alerts"), true);
  assert.equal(isAppShellPath("/app/colonies"), true);
});

test("isAppShellPath: read-cacheable pages are NOT shell (SWR owns them)", () => {
  assert.equal(isAppShellPath("/app/colonies/abc"), false);
  assert.equal(isAppShellPath("/app/colonies/abc/cats/cat-9"), false);
  // feed + today now flipped into the SWR read-cache (A+D), so NOT shell.
  assert.equal(isAppShellPath("/app/colonies/abc/feed"), false);
  assert.equal(isAppShellPath("/app/today"), false);
});

test("isAppShellPath: non-/app paths are not the app shell", () => {
  assert.equal(isAppShellPath("/"), false);
  assert.equal(isAppShellPath("/login"), false);
  assert.equal(isAppShellPath("/api/feedings"), false);
});
