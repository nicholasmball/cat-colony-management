"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/active-org";

export async function createColony(formData: FormData) {
  const org = await getActiveOrg();
  if (!org) redirect("/app");

  const name = String(formData.get("name") ?? "").trim();
  const start = String(formData.get("feeding_window_start") ?? "") || null;
  const end = String(formData.get("feeding_window_end") ?? "") || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const supabase = await createClient();
  const { error } = await supabase.from("colonies").insert({
    organisation_id: org.organisation_id,
    name,
    feeding_window_start: start,
    feeding_window_end: end,
    notes,
  });

  if (error) {
    redirect(`/app/colonies/new?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/app/colonies");
  redirect("/app/colonies");
}
