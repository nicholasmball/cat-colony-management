import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveOrg } from "@/lib/active-org";
import { isKeyInOrg } from "@/lib/photo-key";
import { UNCONFIRMED_STATUS } from "@/lib/cat-report";
import { parseCatReportInput } from "@/lib/api/cat-report-input";
import { planNewCatAlert } from "@/lib/alert-engine";
import { alertRecipients } from "@/lib/alert-recipients";
import { persistAlerts } from "@/lib/alert-persist";

// JSON route handler for "Report a new cat" — the online transport the offline
// outbox (Phase 2) will later replay against. EXACT equivalent of reportCat
// (app/app/colonies/[id]/cats/report/actions.ts): any org member may report,
// at least one identifier (name OR description) is required, the colony is
// re-validated against the caller's org, the photo key is org-scope-guarded,
// and the new-cat alert hook stays server-side. Differences: a CLIENT-SUPPLIED
// UUID `id` (idempotent replay via upsert) and JSON instead of a redirect. The
// old server action stays in place as the reversible fallback.
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

  const parsed = parseCatReportInput(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: parsed.error },
      { status: 400 },
    );
  }
  const input = parsed.value;

  // The presigned key is client-supplied; only keep one minted under this org's
  // prefix (`org/{orgId}/…`). A foreign/tampered key is dropped to null (treated
  // as no photo), consistent with the non-blocking photo rule.
  const photoKey = isKeyInOrg(input.photoKey, org.organisation_id)
    ? input.photoKey
    : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Idempotent-replay gate (org-scoped): this cat id was already reported.
  if (input.id) {
    const { data: prior } = await supabase
      .from("cats")
      .select("id")
      .eq("id", input.id)
      .eq("organisation_id", org.organisation_id)
      .maybeSingle();
    if (prior) {
      return NextResponse.json({ ok: true, id: input.id, duplicate: true });
    }
  }

  // Cross-org write integrity: the colony_id is client-supplied and RLS only
  // checks org membership + status, so re-validate the colony belongs to the
  // caller's active org before inserting (mirrors the action + presign branch).
  const t = await getTranslations("errors");
  const { data: colony } = await supabase
    .from("colonies")
    .select("id, name")
    .eq("id", input.colonyId)
    .eq("organisation_id", org.organisation_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!colony) {
    return NextResponse.json(
      { ok: false, error: t("colonyNotFound") },
      { status: 400 },
    );
  }

  // Client UUID as PK; onConflict:"id" + ignoreDuplicates makes a racing replay
  // a no-op rather than a duplicate-key error. reported_by is the session user,
  // never client-supplied.
  const { error } = await supabase.from("cats").upsert(
    {
      id: input.id,
      organisation_id: org.organisation_id,
      colony_id: input.colonyId,
      name: input.name,
      temp_id: input.tempId,
      colour: input.colour,
      sex: input.sex,
      neutered: input.neutered,
      notes: input.notes,
      photo_url: photoKey,
      status: UNCONFIRMED_STATUS,
      reported_by: user?.id ?? null,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message || t("couldNotSaveCat") },
      { status: 400 },
    );
  }

  // ── Non-blocking new-cat alert hook (VERBATIM from reportCat) ──
  // Fan a routine alert to caretakers+admins. A failure here must NEVER fail the
  // report; records intent only (dispatched_at stays NULL). Stays service-role.
  try {
    const svc = createServiceClient();
    const { data: members } = await svc
      .from("memberships")
      .select("user_id, role, deleted_at")
      .eq("organisation_id", org.organisation_id);
    const recipients = alertRecipients(members ?? []);
    if (recipients.length > 0) {
      const specs = planNewCatAlert({
        catId: input.id,
        colonyId: input.colonyId,
        colonyName: colony?.name ?? "",
        catName: input.name?.trim() || input.tempId?.trim() || "",
        reporterName: user?.email ?? "",
      });
      await persistAlerts(svc, org.organisation_id, specs, recipients);
    }
  } catch {
    // Swallow: the cat report stands regardless of the alert fan-out.
  }

  // Mirror the action's photo=failed contract: the client flags a failed upload
  // and we have no usable key → surface the non-blocking photo warning so the UI
  // can append &photo=failed on the success navigation (the cat itself saved).
  const photoFailed = input.photoFailed && !photoKey;
  return NextResponse.json({
    ok: true,
    id: input.id,
    ...(photoFailed ? { photoFailed: true } : {}),
  });
}
