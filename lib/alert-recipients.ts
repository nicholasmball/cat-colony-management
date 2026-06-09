// Pure recipient resolver for the alert engine's fan-out. Given an org's
// membership rows, return the user ids that should RECEIVE an alert: active
// caretakers + admins (feeders report from the field; they don't triage). The
// actual membership fetch is I/O in the route/action — this is just the filter,
// kept pure so the "who gets alerted" rule is unit-tested once and shared by the
// event hooks and the cron route.
//
// Mirrors the dashboard's manager guard (admin|caretaker) and the 0003_rls
// has_org_role('{admin,caretaker}') write matrix. Deduplicates so a user with an
// odd duplicate membership row isn't fanned to twice (the dedup index would also
// block it, but resolving once is cheaper and clearer).

export type AlertMembership = {
  user_id: string;
  role: string; // public.app_role: 'admin' | 'caretaker' | 'feeder'
  // memberships.deleted_at (0001_init): a departed volunteer is soft-deleted.
  // Null/absent = active. A non-null value = deactivated → never alerted.
  deleted_at?: string | null;
};

const RECIPIENT_ROLES = new Set(["admin", "caretaker"]);

export function alertRecipients(
  memberships: readonly AlertMembership[],
): string[] {
  const seen = new Set<string>();
  for (const m of memberships) {
    // Only an explicit deleted_at deactivates. A departed volunteer is
    // soft-deleted, never alerted (CLAUDE.md: "departure = deactivate").
    if (m.deleted_at != null) continue;
    if (!RECIPIENT_ROLES.has(m.role)) continue;
    seen.add(m.user_id);
  }
  return [...seen];
}
