// Pure selection logic for "which of the caller's memberships is the active one".
//
// Side-effect-free (no supabase/next imports) so it can be unit-tested without a
// live DB. `getActiveOrg` loads the rows and defers the *choice* to here.
//
// SECURITY INVARIANT — DO NOT DROP: `rows` MUST already be filtered to the
// current user (the DB query must keep `.eq("user_id", …)`). RLS lets a manager
// read the *whole org's* memberships, so if an unscoped set is passed in, a
// caretaker/feeder could be handed someone else's row and be mis-scoped as admin
// (the "mis-scoped as admin" privilege-escalation bug). This helper only ever
// returns one of the rows it is given — it never invents a role — but it cannot
// see who the rows belong to, so the user-scoping must happen before this call.

export type ActiveMembershipRow = {
  organisation_id: string;
  role: string;
  organisations: { name: string; timezone: string | null } | null;
};

// Choose the active membership from the caller's own (user-scoped) rows.
//
// - `preferredOrgId` (from the active_org cookie) present in `rows` → that row,
//   so a multi-org switcher honours the user's choice.
// - otherwise → the earliest row, which assumes `rows` is ordered by
//   `created_at` ascending (the DB query supplies that order).
//
// Returns undefined when there are no rows. A stale/tampered cookie is harmless:
// an org id that isn't among the caller's rows simply falls through to earliest.
export function pickActiveMembership<T extends ActiveMembershipRow>(
  rows: readonly T[],
  preferredOrgId?: string,
): T | undefined {
  if (preferredOrgId) {
    const preferred = rows.find((r) => r.organisation_id === preferredOrgId);
    if (preferred) return preferred;
  }
  // Earliest membership — relies on the caller ordering by created_at asc.
  return rows[0];
}
