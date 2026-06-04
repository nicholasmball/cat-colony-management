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
        "Enter a name or a description (at least one).",
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

export async function updateCat(formData: FormData) {
  const catId = String(formData.get("cat_id"));
  const colonyId = String(formData.get("colony_id"));
  const org = await getActiveOrg();
  if (!org) redirect("/app");

  const name = String(formData.get("name") ?? "").trim() || null;
  const tempId = String(formData.get("temp_id") ?? "").trim() || null;
  const editPath = `/app/colonies/${colonyId}/cats/${catId}/edit`;
  // Same rule as create: at least one identifier, never block on the rest.
  if (!name && !tempId) {
    redirect(
      `${editPath}?error=${encodeURIComponent(
        "Enter a name or a description (at least one).",
      )}`,
    );
  }
  // Tri-state so "unknown" stays null — records accept incomplete data.
  const neuteredRaw = String(formData.get("neutered") ?? "");
  const neutered =
    neuteredRaw === "yes" ? true : neuteredRaw === "no" ? false : null;

  const supabase = await createClient();
  // RLS scopes this to the caller's org and Caretaker/Admin role.
  const { error } = await supabase
    .from("cats")
    .update({
      name,
      temp_id: tempId,
      colour: String(formData.get("colour") ?? "").trim() || null,
      markings: String(formData.get("markings") ?? "").trim() || null,
      sex: String(formData.get("sex") ?? "").trim() || null,
      neutered,
      approx_age: String(formData.get("approx_age") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
    })
    .eq("id", catId);

  if (error) {
    redirect(`${editPath}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath(`/app/colonies/${colonyId}`);
  redirect(`/app/colonies/${colonyId}`);
}

// The 30-second feeding update: one append-only feeding_event for the colony,
// plus one append-only cat_sighting per cat the feeder marked.
export async function submitFeeding(formData: FormData) {
  const colonyId = String(formData.get("colony_id"));
  const org = await getActiveOrg();
  if (!org) redirect("/app");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const feederId = user?.id ?? null;

  const { data: event, error: eventError } = await supabase
    .from("feeding_events")
    .insert({
      organisation_id: org.organisation_id,
      colony_id: colonyId,
      feeder_id: feederId,
      fed: formData.get("fed") === "1",
      problem: formData.get("problem") === "1",
      food_issue: formData.get("food_issue") === "1",
      danger: formData.get("danger") === "1",
      notes: String(formData.get("notes") ?? "").trim() || null,
    })
    .select("id")
    .single();

  if (eventError || !event) {
    redirect(
      `/app/colonies/${colonyId}/feed?error=${encodeURIComponent(
        eventError?.message ?? "Could not save the feeding update.",
      )}`,
    );
  }

  const sightings: {
    organisation_id: string;
    cat_id: string;
    feeding_event_id: string;
    feeder_id: string | null;
    status: string;
  }[] = [];
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("cat:") && typeof value === "string" && value) {
      sightings.push({
        organisation_id: org.organisation_id,
        cat_id: key.slice(4),
        feeding_event_id: event.id,
        feeder_id: feederId,
        status: value,
      });
    }
  }

  if (sightings.length > 0) {
    const { error: sightingError } = await supabase
      .from("cat_sightings")
      .insert(sightings);
    if (sightingError) {
      redirect(
        `/app/colonies/${colonyId}/feed?error=${encodeURIComponent(sightingError.message)}`,
      );
    }
  }

  revalidatePath(`/app/colonies/${colonyId}`);
  redirect(`/app/colonies/${colonyId}?updated=1`);
}
