import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import withSerwistInit from "@serwist/next";

// Points at ./i18n/request.ts by default.
const withNextIntl = createNextIntlPlugin();

// Serwist (Phase 3) compiles app/sw.ts → public/sw.js.
//
// SAFETY LOCK #1 (build): `disable` is true UNLESS NEXT_PUBLIC_SW_ENABLED ===
// "true". When disabled, withSerwist emits NO public/sw.js at all — so CI,
// preview and prod stay SW-free by default and merging this PR cannot register a
// SW in production. (Lock #2 is the register gate in components/sw-register.tsx,
// which also won't register unless the same flag is on.) Enabling the flag is the
// separate human Deploy gate.
//
// `register: false` — registration is owned exclusively by the Phase-0 gated
// component (sw-register.tsx), NOT auto-injected by Serwist, so the kill-switch /
// flag logic stays the single source of truth for SW lifecycle.
const swEnabled = process.env.NEXT_PUBLIC_SW_ENABLED === "true";
const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: !swEnabled,
  register: false,
  reloadOnOnline: false,
});

// Baseline security headers applied to every response. A full Content-Security
// -Policy is deferred to the hardening task (it needs testing against Supabase
// auth/storage and any future embeds). camera/geolocation are left enabled for
// `self` since the app will use the camera (cat photos) and GPS (colonies).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(self), microphone=(), geolocation=(self), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  // Per-build revision exposed to app/sw.ts for versioning the runtime read-page
  // cache (scot-read-pages-<rev>). On Vercel this is the short commit SHA so a new
  // deploy gets a fresh cache + the SW's activate handler evicts the old one,
  // preventing a previous build's RSC payloads from being served by the new shell.
  // Date.now() is evaluated at build time (config eval), NOT inside a workflow
  // script, so a dev/local build just gets a unique-per-build dev marker.
  env: {
    NEXT_PUBLIC_SW_BUILD_REV:
      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? `dev-${Date.now()}`,
    // The build's commit SHA, stamped onto feedback rows (lib/app-version.ts) so
    // the app team can pin a UAT report to an exact deploy. "dev" off Vercel.
    NEXT_PUBLIC_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withSerwist(withNextIntl(nextConfig));
