"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/active-org";

// Admin-only: edit the organisation's name + notes. RLS ("admin updates
// organisation") backs this up, but re-check the role server-side anyway.
export async function updateOrganisation(formData: FormData) {
  const org = await getActiveOrg();
  if (!org) redirect("/app");
  if (org.role !== "admin") redirect("/app");

  const name = String(formData.get("name") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;
  if (!name) {
    redirect(`/app/org?error=${encodeURIComponent("Organisation name is required.")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("organisations")
    .update({ name, notes })
    .eq("id", org.organisation_id);
  if (error) {
    redirect(`/app/org?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/app/org");
  revalidatePath("/app"); // home card shows the name
  redirect("/app/org?saved=1");
}
