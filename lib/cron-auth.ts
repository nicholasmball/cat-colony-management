// Pure bearer-secret check for the cron routes — extracted so the "reject a
// missing/empty/mismatched secret" rule is node:test-able without spinning up a
// route handler. Mirrors the inlined guard in /api/cron/alerts exactly:
//   * a missing/empty CRON_SECRET ALWAYS rejects (no empty-secret bypass —
//     Bearer "" / "undefined" can never match a real secret), AND
//   * the Authorization header must be exactly `Bearer <secret>`.
// Used by /api/cron/email-digest.
export function cronAuthorized(
  secret: string | undefined,
  authHeader: string | null,
): boolean {
  if (!secret) return false;
  return authHeader === `Bearer ${secret}`;
}
