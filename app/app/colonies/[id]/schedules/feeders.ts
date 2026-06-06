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
