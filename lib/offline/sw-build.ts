// PURE build-mode decision for `next build` (Phase 3). NO process spawning, NO
// fs — just the flag→bundler reasoning, so it's node:test-able (see
// sw-build.test.ts) and the thin scripts/build.mjs caller stays trivial.
//
// WHY this exists: Next.js 16 builds with Turbopack by default, but the
// well-trodden @serwist/next plugin injects the service worker via a WEBPACK
// plugin and does NOT support Turbopack — so a Turbopack build silently emits NO
// sw.js even when NEXT_PUBLIC_SW_ENABLED=true. That silent gap is a footgun at
// the Deploy gate. This decision makes the rule explicit and tested:
//   • SW disabled (the default)  → Turbopack `next build` (fast, no SW — today's
//                                  behaviour, zero risk).
//   • SW enabled (Deploy gate)   → `next build --webpack` so Serwist actually
//                                  compiles app/sw.ts → public/sw.js.
// So enabling the SW in prod is JUST setting the env var — the bundler switch is
// automatic and can't be forgotten.

export type BuildPlan = {
  // Extra args to append to `next build` (e.g. ["--webpack"]).
  args: string[];
  // Whether this build will emit a service worker.
  swEnabled: boolean;
};

// Decide the build plan from the SW-enabled flag (the same NEXT_PUBLIC_SW_ENABLED
// string the runtime reads). Uses the strict "true" coercion to match
// lib/offline/sw-flags.ts envFlag — a typo can never accidentally arm the SW.
export function planBuild(swEnabledFlag: string | undefined): BuildPlan {
  const swEnabled = swEnabledFlag?.trim().toLowerCase() === "true";
  return {
    swEnabled,
    // Webpack only when the SW must be built; otherwise let Next use its default
    // (Turbopack). We pass NO bundler flag in the default case so we never fight
    // a future Next default.
    args: swEnabled ? ["--webpack"] : [],
  };
}
