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

export async function updateColony(formData: FormData) {
  const id = String(formData.get("id"));
  const name = String(formData.get("name") ?? "").trim();
  const start = String(formData.get("feeding_window_start") ?? "") || null;
  const end = String(formData.get("feeding_window_end") ?? "") || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const isActive = formData.get("is_active") === "on";

  const supabase = await createClient();
  const { error } = await supabase
    .from("colonies")
    .update({
      name,
      feeding_window_start: start,
      feeding_window_end: end,
      notes,
      is_active: isActive,
    })
    .eq("id", id);

  if (error) {
    redirect(
      `/app/colonies/${id}/edit?error=${encodeURIComponent(error.message)}`,
    );
  }
  revalidatePath(`/app/colonies/${id}`);
  revalidatePath("/app/colonies");
  redirect(`/app/colonies/${id}`);
}

export async function archiveColony(formData: FormData) {
  const id = String(formData.get("id"));
  const supabase = await createClient();
  const { error } = await supabase
    .from("colonies")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    redirect(
      `/app/colonies/${id}/edit?error=${encodeURIComponent(error.message)}`,
    );
  }
  revalidatePath("/app/colonies");
  redirect("/app/colonies");
}

export async function createCat(formData: FormData) {
  const colonyId = String(formData.get("colony_id"));
  const org = await getActiveOrg();
  if (!org) redirect("/app");

  const name = String(formData.get("name") ?? "").trim() || null;
  const tempId = String(formData.get("temp_id") ?? "").trim() || null;
  // Schema requires a name OR a temp id — never block on the rest.
  if (!name && !tempId) {
    redirect(
      `/app/colonies/${colonyId}/cats/new?error=${encodeURIComponent(
        "Enter a name or a temporary ID (at least one).",
      )}`,
    );
  }
  const colour = String(formData.get("colour") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const supabase = await createClient();
  const { error } = await supabase.from("cats").insert({
    organisation_id: org.organisation_id,
    colony_id: colonyId,
    name,
    temp_id: tempId,
    colour,
    notes,
    status: "active",
  });

  if (error) {
    redirect(
      `/app/colonies/${colonyId}/cats/new?error=${encodeURIComponent(error.message)}`,
    );
  }
  revalidatePath(`/app/colonies/${colonyId}`);
  redirect(`/app/colonies/${colonyId}`);
}
