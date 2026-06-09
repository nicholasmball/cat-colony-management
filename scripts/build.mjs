// Thin `next build` launcher (Phase 3). Picks the bundler from
// NEXT_PUBLIC_SW_ENABLED:
//   • SW off (default) → `next build` (Turbopack — today's behaviour, no sw.js).
//   • SW on (Deploy gate) → `next build --webpack` so @serwist/next can inject
//     the service worker (it does NOT support Turbopack, so a Turbopack build
//     would silently emit NO sw.js even with the flag on).
// The decision mirrors lib/offline/sw-build.ts `planBuild()` (which is the
// node:tested spec for this rule — strict "true" allowlist); kept inline here so
// the launcher has no .ts import. Enabling the SW in prod is JUST setting the env
// var — the bundler switch is automatic and can't be forgotten.

import { spawn } from "node:child_process";

const swEnabled =
  (process.env.NEXT_PUBLIC_SW_ENABLED ?? "").trim().toLowerCase() === "true";

const args = ["build"];
if (swEnabled) {
  args.push("--webpack");
  // Quiet Serwist's "Turbopack not supported" warning — we deliberately use
  // webpack for the SW build, so the warning is noise here.
  process.env.SERWIST_SUPPRESS_TURBOPACK_WARNING = "1";
  console.log(
    "[build] NEXT_PUBLIC_SW_ENABLED=true → building WITH service worker (webpack).",
  );
} else {
  console.log(
    "[build] service worker disabled (default) → standard build, no sw.js.",
  );
}

const child = spawn("next", args, { stdio: "inherit", env: process.env });
child.on("exit", (code) => process.exit(code ?? 1));
