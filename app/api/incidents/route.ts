import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveOrg } from "@/lib/active-org";
import { isKeyInOrg } from "@/lib/photo-key";
import { defaultUrgencyLevel, type UrgencyLevel } from "@/lib/incident";
import { parseIncidentInput } from "@/lib/api/incident-input";
import { planIncidentAlert } from "@/lib/alert-engine";
import { alertRecipients } from "@/lib/alert-recipients";
import { persistAlerts } from "@/lib/alert-persist";

// JSON route handler for "Report an incident" — the online transport the offline
// outbox (Phase 2) will later replay against. EXACT equivalent of createIncident
// (app/app/colonies/[id]/incidents/actions.ts): any org member may report,
// `type` is the only required field (enum-validated in the input lib), urgency
// is resolved/defaulted against the org's lookup (never null — the alert seam),
// an optional cat is re-validated against this colony+org, the online photo is
// attached non-blockingly, and the incident alert hook stays server-side.
// Differences: a CLIENT-SUPPLIED UUID `id` (idempotent replay via upsert) and
// JSON instead of a redirect. The old server action stays as the fallback.
export async function POST(req: Request) {
  const org = await getActiveOrg();
  if (!org) {
    return NextResponse.json(
      { ok: false, error: "Not signed in." },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Bad request." },
      { status: 400 },
    );
  }

  const parsed = parseIncidentInput(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: parsed.error },
      { status: 400 },
    );
  }
  const input = parsed.value;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const reporterId = user?.id ?? null;
  const t = await getTranslations("errors");

  // Idempotent-replay gate (org-scoped): this incident id was already reported.
  // We still want the success response to carry `urgent` so the UI navigates the
  // same way, so read back the level's flag on a duplicate.
  {
    const { data: prior } = await supabase
      .from("incidents")
      .select("id, urgency_level_id")
      .eq("id", input.id)
      .eq("organisation_id", org.organisation_id)
      .maybeSingle();
    if (prior) {
      let urgent = false;
      if (prior.urgency_level_id) {
        const { data: lvl } = await supabase
          .from("incident_urgency_levels")
          .select("alerts_immediately")
          .eq("id", prior.urgency_level_id as string)
          .maybeSingle();
        urgent = lvl?.alerts_immediately ?? false;
      }
      return NextResponse.json({
        ok: true,
        id: input.id,
        urgent,
        duplicate: true,
      });
    }
  }

  // The org's urgency lookup — validate a submitted id and resolve the default.
  // RLS scopes this read. The result must be non-null (the alert seam).
  const { data: levelsData } = await supabase
    .from("incident_urgency_levels")
    .select("id, key, label, sort_order, alerts_immediately")
    .eq("organisation_id", org.organisation_id)
    .order("sort_order", { ascending: true });
  const levels = (levelsData ?? []) as UrgencyLevel[];
  const chosen =
    levels.find((l) => l.id === input.urgencyLevelId) ??
    defaultUrgencyLevel(levels);
  if (!chosen) {
    return NextResponse.json(
      { ok: false, error: t("noUrgencyConfigured") },
      { status: 400 },
    );
  }

  // Optional cat — only attach it if it really belongs to THIS colony (+ org via
  // RLS). A stale/foreign id is dropped to null rather than failing the report.
  let catId: string | null = null;
  if (input.catId) {
    const { data: cat } = await supabase
      .from("cats")
      .select("id")
      .eq("id", input.catId)
      .eq("colony_id", input.colonyId)
      .eq("organisation_id", org.organisation_id)
      .is("deleted_at", null)
      .maybeSingle();
    catId = cat?.id ?? null;
  }

  // Client UUID as PK; onConflict:"id" + ignoreDuplicates makes a racing replay
  // a no-op rather than a duplicate-key error. status is DB-set; occurred_at is
  // the client field time when present, else the DB default (see below).
  const { error } = await supabase.from("incidents").upsert(
    {
      id: input.id,
      organisation_id: org.organisation_id,
      colony_id: input.colonyId,
      cat_id: catId,
      type: input.type,
      urgency_level_id: chosen.id,
      notes: input.notes,
      reported_by: reporterId,
      // Client-captured field time. Omitted when absent so Postgres keeps the
      // occurred_at = now() default (online pre-fix behaviour + old queued
      // items); created_at stays the DB default = insert/sync time.
      ...(input.occurredAt ? { occurred_at: input.occurredAt } : {}),
    },
    { onConflict: "id", ignoreDuplicates: true },
  );

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message || t("couldNotSaveIncident") },
      { status: 400 },
    );
  }

  // Non-blocking photo (online-only, unchanged): the incident is already saved.
  // A failed attachment insert must NOT roll back the incident — surface a soft
  // warning instead. The key is client-supplied; only attach one minted under
  // this org's prefix.
  let photoWarning = false;
  const photoKey = isKeyInOrg(input.photoKey, org.organisation_id)
    ? input.photoKey
    : "";
  if (photoKey) {
    const { error: attachError } = await supabase.from("attachments").insert({
      organisation_id: org.organisation_id,
      entity_type: "incident",
      entity_id: input.id,
      storage_path: photoKey,
      content_type: "image/jpeg",
      uploaded_by: reporterId,
    });
    if (attachError) photoWarning = true;
  } else if (input.photoFailed) {
    photoWarning = true;
  }

  // ── Non-blocking incident alert hook (VERBATIM from createIncident) ──
  // Urgent (alerts_immediately) → push+sms intent; routine → in_app+email. A
  // failure here must NEVER roll back or fail the report; records intent only
  // (dispatched_at stays NULL). Stays service-role.
  try {
    const svc = createServiceClient();
    const [{ data: colony }, { data: members }] = await Promise.all([
      svc
        .from("colonies")
        .select("name")
        .eq("id", input.colonyId)
        .maybeSingle(),
      svc
        .from("memberships")
        .select("user_id, role, deleted_at")
        .eq("organisation_id", org.organisation_id),
    ]);
    const recipients = alertRecipients(members ?? []);
    if (recipients.length > 0) {
      const specs = planIncidentAlert({
        incidentId: input.id,
        colonyId: input.colonyId,
        catId,
        incidentType: input.type,
        colonyName: colony?.name ?? "",
        reporterName: user?.email ?? "",
        urgent: chosen.alerts_immediately,
      });
      await persistAlerts(svc, org.organisation_id, specs, recipients);
    }
  } catch {
    // Swallow: the incident report stands regardless of the alert fan-out.
  }

  return NextResponse.json({
    ok: true,
    id: input.id,
    urgent: chosen.alerts_immediately,
    ...(photoWarning ? { photoFailed: true } : {}),
  });
}
