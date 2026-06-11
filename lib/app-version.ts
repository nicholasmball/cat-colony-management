// The build's commit SHA, exposed at build time via next.config's `env` as
// NEXT_PUBLIC_COMMIT_SHA (set to VERCEL_GIT_COMMIT_SHA on Vercel, "dev" locally).
// Stamped onto each feedback row's app_version so the app team knows exactly
// which build a report came from. Pure + dependency-free so it's unit-testable.
export function appVersion(): string {
  const sha = process.env.NEXT_PUBLIC_COMMIT_SHA;
  return sha && sha.length > 0 ? sha : "dev";
}
