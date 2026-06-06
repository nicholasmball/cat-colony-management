import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

// Cookie holding the user's chosen active organisation. Set by switchOrg /
// createOrganisation; honoured here. A stale or tampered value is harmless —
// we only ever resolve it to one of the *caller's own* membership rows.
export const ACTIVE_ORG_COOKIE = "active_org";

export type ActiveOrg = {
  organisation_id: string;
  name: string;
  role: string;
  timezone: string;
};

type MembershipRow = {
  organisation_id: string;
  role: string;
  organisations: { name: string; timezone: string | null } | null;
};

// Fetch one membership for this user — a specific org if `orgId` is given,
// otherwise the earliest. MUST filter by user_id: RLS lets managers read the
// whole org's memberships, so without it a caretaker/feeder could pick up
// someone else's row and be mis-scoped.
async function fetchMembership(
  supabase: SupabaseClient,
  userId: string,
  orgId?: string,
): Promise<MembershipRow | undefined> {
  let q = supabase
    .from("memberships")
    .select("organisation_id, role, organisations(name, timezone)")
    .eq("user_id", userId)
    .is("deleted_at", null);
  q = orgId
    ? q.eq("organisation_id", orgId)
    : q.order("created_at", { ascending: true });
  const { data } = await q.limit(1);
  return data?.[0] as MembershipRow | undefined;
}

// The active organisation = the cookie-selected one if the caller is a member
// of it, else their earliest membership. A proper multi-org switcher writes the
// cookie via switchOrg; this resolves + validates it.
export async function getActiveOrg(): Promise<ActiveOrg | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const preferred = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;

  let row = preferred
    ? await fetchMembership(supabase, user.id, preferred)
    : undefined;
  if (!row) row = await fetchMembership(supabase, user.id);
  if (!row) return null;

  return {
    organisation_id: row.organisation_id,
    name: row.organisations?.name ?? "Organisation",
    role: row.role,
    // Column is NOT NULL default Lisbon; fall back defensively.
    timezone: row.organisations?.timezone ?? "Europe/Lisbon",
  };
}
