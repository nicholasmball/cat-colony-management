"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_ORG_COOKIE } from "@/lib/active-org";

const ORG_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 365, // a year
};

export async function createOrganisation(formData: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_organisation", {
    p_name: String(formData.get("name") ?? ""),
  });
  if (error) {
    redirect(`/app?error=${encodeURIComponent(error.message)}`);
  }
  // RPC returns the new org's uuid — make it the active org so the user lands
  // in the org they just created, not their earliest one.
  if (typeof data === "string") {
    (await cookies()).set(ACTIVE_ORG_COOKIE, data, ORG_COOKIE_OPTS);
  }
  revalidatePath("/app");
  redirect("/app");
}

// Switch the active organisation. Validates the caller actually belongs to the
// target org before honouring it (defence in depth on top of RLS), then sets
// the cookie getActiveOrg reads.
export async function switchOrg(formData: FormData) {
  const orgId = String(formData.get("org") ?? "");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("memberships")
    .select("organisation_id")
    .eq("user_id", user.id)
    .eq("organisation_id", orgId)
    .is("deleted_at", null)
    .limit(1);

  if (membership?.[0]) {
    (await cookies()).set(ACTIVE_ORG_COOKIE, orgId, ORG_COOKIE_OPTS);
  }
  redirect("/app/colonies");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
