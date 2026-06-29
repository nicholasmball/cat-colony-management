import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

export type AssignableFeeder = { user_id: string; email: string };

// Org members who can be scheduled to feed: active feeders + caretakers,
// labelled by email (the only personal data we hold). Service client because
// emails live in auth.users; caller must already be a verified manager.
export async function getAssignableFeeders(
  organisationId: string,
): Promise<AssignableFeeder[]> {
  const svc = createServiceClient();
  const { data: rows } = await svc
    .from("memberships")
    .select("user_id, role")
    .eq("organisation_id", organisationId)
    .in("role", ["feeder", "caretaker"])
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  const members = rows ?? [];
  const feeders = await Promise.all(
    members.map(async (m) => {
      const { data } = await svc.auth.admin.getUserById(m.user_id as string);
      return {
        user_id: m.user_id as string,
        email: data.user?.email ?? "unknown",
      };
    }),
  );
  return feeders.sort((a, b) => a.email.localeCompare(b.email));
}

export type PendingInvite = { email: string };

// Pending (un-accepted) FEEDER invitations for the org — surfaced read-only on
// the Add-schedule form as greyed "Invited · pending" entries so an admin who
// just invited someone sees the result without going to Members. These are NOT
// assignable (no accepted membership yet), so they never enter the feeder
// <select>; getAssignableFeeders stays the source of truth for that. Bounded
// select (one column, org-scoped, role + accepted filters). Service client
// because invitations are admin-only; caller must already be a verified admin.
export async function getPendingFeederInvites(
  organisationId: string,
): Promise<PendingInvite[]> {
  const svc = createServiceClient();
  const { data } = await svc
    .from("invitations")
    .select("email")
    .eq("organisation_id", organisationId)
    .eq("role", "feeder")
    .is("accepted_at", null)
    .order("created_at", { ascending: true });
  return (data ?? []).map((r) => ({ email: r.email as string }));
}
