import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  pickActiveMembership,
  type ActiveMembershipRow,
} from "@/lib/active-membership";

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

type MembershipRow = ActiveMembershipRow;

// Fetch this user's memberships, earliest first. MUST filter by user_id: RLS
// lets managers read the whole org's memberships, so without it a
// caretaker/feeder could pick up someone else's row and be mis-scoped as admin.
// The user-scoping lives HERE; the (cookie vs. earliest) *selection* is the pure
// `pickActiveMembership`, which can only ever return one of these rows.
async function fetchMemberships(
  supabase: SupabaseClient,
  userId: string,
): Promise<MembershipRow[]> {
  const { data } = await supabase
    .from("memberships")
    .select("organisation_id, role, organisations(name, timezone)")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  return (data ?? []) as unknown as MembershipRow[];
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

  // fetchMemberships is user-scoped + ordered; the choice is pure & tested.
  const rows = await fetchMemberships(supabase, user.id);
  const row = pickActiveMembership(rows, preferred);
  if (!row) return null;

  return {
    organisation_id: row.organisation_id,
    name: row.organisations?.name ?? "Organisation",
    role: row.role,
    // Column is NOT NULL default Lisbon; fall back defensively.
    timezone: row.organisations?.timezone ?? "Europe/Lisbon",
  };
}
