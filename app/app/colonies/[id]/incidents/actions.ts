"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/active-org";
import {
  defaultUrgencyLevel,
  isValidIncidentType,
  type UrgencyLevel,
} from "@/lib/incident";

// Report one incident against a colony. Any org member may report (RLS:
// "members insert incidents" / "members insert attachments" — org-membership
// only, no auth.uid() write-check), so we use the RLS-bound createClient(), NOT
// the service role. The colony comes from the trusted route param; the org from
// getActiveOrg(); reported_by from the auth session — none are client-supplied.
//
// Alert seam (approved): a reported incident simply EXISTS with a non-null
// urgency_level_id. This action imports/calls ZERO alert or notification code —
// a later alert engine reads the row. Hence urgency must never insert as null.
export async function createIncident(formData: FormData) {
  const colonyId = String(formData.get("colony_id"));
  const org = await getActiveOrg();
  if (!org) redirect("/app");

  const newPath = `/app/colonies/${colonyId}/incidents/new`;
  function fail(message: string): never {
    redirect(`${newPath}?error=${encodeURIComponent(message)}`);
  }

  // Type is the ONLY required field. Validate against the real enum so a bad
  // value never reaches Postgres.
  const type = formData.get("type");
  if (!isValidIncidentType(type)) {
    fail("Choose what's happening before you report.");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const reporterId = user?.id ?? null;

  // The org's urgency lookup, for both validating a submitted id and resolving
  // the default. RLS ("members read incident_urgency_levels") scopes this read.
  const { data: levelsData } = await supabase
    .from("incident_urgency_levels")
    .select("id, key, label, sort_order, alerts_immediately")
    .eq("organisation_id", org.organisation_id)
    .order("sort_order", { ascending: true });
  const levels = (levelsData ?? []) as UrgencyLevel[];

  // Honour a submitted urgency only if it's really one of this org's levels;
  // otherwise default to the org's not-urgent baseline. Either way the result
  // must be non-null (the alert seam).
  const submittedUrgency = String(formData.get("urgency_level_id") ?? "");
  const chosen =
    levels.find((l) => l.id === submittedUrgency) ??
    defaultUrgencyLevel(levels);
  if (!chosen) {
    fail("This organisation has no urgency levels configured yet.");
  }

  // Optional cat — only accept it if it really belongs to THIS colony (and the
  // caller's org, via RLS). A stale/foreign id is dropped to null rather than
  // failing the report.
  let catId: string | null = null;
  const submittedCat = String(formData.get("cat_id") ?? "");
  if (submittedCat) {
    const { data: cat } = await supabase
      .from("cats")
      .select("id")
      .eq("id", submittedCat)
      .eq("colony_id", colonyId)
      .eq("organisation_id", org.organisation_id)
      .is("deleted_at", null)
      .maybeSingle();
    catId = cat?.id ?? null;
  }

  const notes = String(formData.get("notes") ?? "").trim() || null;

  const { data: incident, error } = await supabase
    .from("incidents")
    .insert({
      organisation_id: org.organisation_id,
      colony_id: colonyId,
      cat_id: catId,
      type,
      urgency_level_id: chosen.id,
      notes,
      reported_by: reporterId,
      // status defaults to 'open'; occurred_at defaults to now() — both DB-set.
    })
    .select("id")
    .single();

  if (error || !incident) {
    fail(error?.message ?? "Could not save the incident.");
  }

  // Non-blocking photo: the incident is already saved. A failed attachment
  // insert must NOT roll back the incident — surface a soft warning instead and
  // keep the report (the field/offline reality from the design).
  let photoWarning = false;
  const photoKey = String(formData.get("photo_key") ?? "").trim();
  if (photoKey) {
    const { error: attachError } = await supabase.from("attachments").insert({
      organisation_id: org.organisation_id,
      entity_type: "incident",
      entity_id: incident.id,
      storage_path: photoKey,
      content_type: "image/jpeg",
      uploaded_by: reporterId,
    });
    if (attachError) photoWarning = true;
  }

  revalidatePath(`/app/colonies/${colonyId}`);
  // Honest success copy lives on the colony page; ?reported carries the urgency
  // so it can say "Flagged as urgent for caretakers" (NOT "...notified" — push/
  // SMS isn't built). photo=failed surfaces the non-blocking attachment warning.
  const params = new URLSearchParams({
    reported: chosen.alerts_immediately ? "urgent" : "1",
  });
  if (photoWarning) params.set("photo", "failed");
  redirect(`/app/colonies/${colonyId}?${params.toString()}`);
}
