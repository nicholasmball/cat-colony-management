"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveOrg } from "@/lib/active-org";
import { isKeyInOrg } from "@/lib/photo-key";
import {
  defaultUrgencyLevel,
  isValidIncidentType,
  type UrgencyLevel,
} from "@/lib/incident";
import { planIncidentAlert } from "@/lib/alert-engine";
import { alertRecipients } from "@/lib/alert-recipients";
import { persistAlerts } from "@/lib/alert-persist";

// Report one incident against a colony. Any org member may report (RLS:
// "members insert incidents" / "members insert attachments" — org-membership
// only, no auth.uid() write-check), so we use the RLS-bound createClient(), NOT
// the service role. The colony comes from the trusted route param; the org from
// getActiveOrg(); reported_by from the auth session — none are client-supplied.
//
// Alert seam (approved): a reported incident EXISTS with a non-null
// urgency_level_id, then — AFTER the row is saved — a NON-BLOCKING hook fans an
// alert to caretakers+admins (urgent if the level alerts_immediately, else
// routine; routine incidents alert in-app too). The fan-out can never roll back
// or fail the report. Urgency must never insert as null (it drives severity).
export async function createIncident(formData: FormData) {
  const colonyId = String(formData.get("colony_id"));
  const org = await getActiveOrg();
  if (!org) redirect("/app");

  const t = await getTranslations("errors");
  const newPath = `/app/colonies/${colonyId}/incidents/new`;
  function fail(message: string): never {
    redirect(`${newPath}?error=${encodeURIComponent(message)}`);
  }

  // Type is the ONLY required field. Validate against the real enum so a bad
  // value never reaches Postgres.
  const type = formData.get("type");
  if (!isValidIncidentType(type)) {
    fail(t("chooseIncidentType"));
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
    fail(t("noUrgencyConfigured"));
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
    fail(error?.message ?? t("couldNotSaveIncident"));
  }

  // Non-blocking photo: the incident is already saved. A failed attachment
  // insert must NOT roll back the incident — surface a soft warning instead and
  // keep the report (the field/offline reality from the design).
  let photoWarning = false;
  const submittedKey = String(formData.get("photo_key") ?? "").trim();
  // The key is client-supplied; only attach one minted under this org's prefix
  // (`org/{orgId}/…`). A foreign/tampered key is dropped (treated as no photo)
  // rather than attached, consistent with the non-blocking photo design.
  const photoKey = isKeyInOrg(submittedKey, org.organisation_id)
    ? submittedKey
    : "";
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

  // Non-blocking alert (fills the documented "alert seam"): the incident is
  // already saved. Fan one alert to the org's caretakers+admins — urgent (the
  // level alerts_immediately) → push+sms intent; routine → in_app+email. A
  // failure here must NEVER roll back or fail the report (mirrors the
  // non-blocking photo pattern above); the cron sweep does not re-raise event
  // alerts, but the dedup key keeps a retry safe. Records intent only — no
  // push/SMS/email is sent here and dispatched_at stays NULL.
  try {
    const svc = createServiceClient();
    const [{ data: colony }, { data: members }] = await Promise.all([
      svc.from("colonies").select("name").eq("id", colonyId).maybeSingle(),
      svc
        .from("memberships")
        .select("user_id, role, deleted_at")
        .eq("organisation_id", org.organisation_id),
    ]);
    const recipients = alertRecipients(members ?? []);
    if (recipients.length > 0) {
      const specs = planIncidentAlert({
        incidentId: incident.id,
        colonyId,
        catId,
        incidentType: String(type),
        colonyName: colony?.name ?? "",
        reporterName: user?.email ?? "",
        urgent: chosen.alerts_immediately,
      });
      await persistAlerts(svc, org.organisation_id, specs, recipients);
    }
  } catch {
    // Swallow: the incident report stands regardless of the alert fan-out.
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
