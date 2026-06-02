import { createClient } from "@/lib/supabase/server";

export type ActiveOrg = { organisation_id: string; name: string; role: string };

// MVP: the user's first (active) membership is the "active" organisation.
// A proper org switcher is deferred until multi-org is real (post-MVP).
export async function getActiveOrg(): Promise<ActiveOrg | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("memberships")
    .select("organisation_id, role, organisations(name)")
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(1);

  const row = data?.[0] as
    | {
        organisation_id: string;
        role: string;
        organisations: { name: string } | null;
      }
    | undefined;
  if (!row) return null;
  return {
    organisation_id: row.organisation_id,
    name: row.organisations?.name ?? "Organisation",
    role: row.role,
  };
}
