import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveOrg } from "@/lib/active-org";
import { parseFeedingInput } from "@/lib/api/feeding-input";
import { planConcernSightingAlert } from "@/lib/alert-engine";
import { alertRecipients } from "@/lib/alert-recipients";
import { persistAlerts } from "@/lib/alert-persist";

// JSON route handler for the "30-second feeding update" — the online transport
// the offline outbox (Phase 2) will later replay against. It is the EXACT
// equivalent of submitFeeding (app/app/colonies/actions.ts), with two
// differences: (1) every row carries a CLIENT-SUPPLIED UUID so a replay can
// upsert the same id idempotently, and (2) it returns JSON instead of a
// redirect. Authz, the RLS-bound writes, and the service-role concern alert hook
// are identical. The old server action stays in place as the reversible fallback.
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

  const parsed = parseFeedingInput(body);
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
  const feederId = user?.id ?? null;

  // Idempotent-replay gate: a feeding_events row with this client UUID already
  // existing means this exact submit was already persisted (a Phase-2 outbox
  // retry or a double-tap). Return success WITHOUT re-inserting or re-alerting —
  // the alert dedup key would also block a duplicate alert, but short-circuiting
  // is cheaper and unambiguous. The read is org-scoped so we never confirm a row
  // we don't own.
  const { data: prior } = await supabase
    .from("feeding_events")
    .select("id")
    .eq("id", input.id)
    .eq("organisation_id", org.organisation_id)
    .maybeSingle();
  if (prior) {
    return NextResponse.json({ ok: true, id: input.id, duplicate: true });
  }

  // The client UUID is the PK. onConflict:"id" + ignoreDuplicates makes a racing
  // replay (two tabs, retry-in-flight) a no-op rather than a duplicate-key error.
  const { error: eventError } = await supabase.from("feeding_events").upsert(
    {
      id: input.id,
      organisation_id: org.organisation_id,
      colony_id: input.colonyId,
      feeder_id: feederId,
      fed: input.fed,
      problem: input.problem,
      food_issue: input.foodIssue,
      danger: input.danger,
      notes: input.notes,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );

  if (eventError) {
    const t = await getTranslations("errors");
    return NextResponse.json(
      { ok: false, error: eventError.message || t("couldNotSaveFeeding") },
      { status: 400 },
    );
  }

  // Per-cat sightings, each with its own client UUID, same idempotent upsert. On
  // a replay these conflict and no-op too. We read them back below (service role)
  // so the alert hook anchors on the DB-set observed_at, exactly as the action.
  if (input.sightings.length > 0) {
    const { error: sightingError } = await supabase
      .from("cat_sightings")
      .upsert(
        input.sightings.map((s) => ({
          id: s.id,
          organisation_id: org.organisation_id,
          cat_id: s.catId,
          feeding_event_id: input.id,
          feeder_id: feederId,
          status: s.status,
        })),
        { onConflict: "id", ignoreDuplicates: true },
      );
    if (sightingError) {
      return NextResponse.json(
        { ok: false, error: sightingError.message },
        { status: 400 },
      );
    }
  }

  const concernSightingIds = input.sightings
    .filter((s) => s.status === "concern")
    .map((s) => s.id);

  // ── Non-blocking concern-sighting alert hook (VERBATIM from submitFeeding) ──
  // Any sighting marked `concern` raises one routine alert per (cat, observed_at)
  // to caretakers+admins. A failure here must NEVER fail the feeding update; it
  // records intent only — no push/SMS/email, dispatched_at stays NULL. Stays
  // server-side (service-role) — the whole point of the route-handler design.
  if (concernSightingIds.length > 0) {
    try {
      const svc = createServiceClient();
      const { data: concernRows } = await svc
        .from("cat_sightings")
        .select("cat_id, observed_at, status")
        .in("id", concernSightingIds);
      const concernSightings = (concernRows ?? []).filter(
        (s) => s.status === "concern",
      );
      if (concernSightings.length > 0) {
        const concernCatIds = [
          ...new Set(concernSightings.map((s) => s.cat_id as string)),
        ];
        const [{ data: colony }, { data: catRows }, { data: members }] =
          await Promise.all([
            svc
              .from("colonies")
              .select("name")
              .eq("id", input.colonyId)
              .maybeSingle(),
            svc
              .from("cats")
              .select("id, name, temp_id")
              .in("id", concernCatIds),
            svc
              .from("memberships")
              .select("user_id, role, deleted_at")
              .eq("organisation_id", org.organisation_id),
          ]);
        const recipients = alertRecipients(members ?? []);
        if (recipients.length > 0) {
          const catNameById = new Map(
            (catRows ?? []).map((c) => [
              c.id as string,
              (c.name as string | null)?.trim() ||
                (c.temp_id as string | null)?.trim() ||
                "",
            ]),
          );
          const specs = concernSightings.flatMap((s) =>
            planConcernSightingAlert({
              catId: s.cat_id as string,
              colonyId: input.colonyId,
              colonyName: colony?.name ?? "",
              catName: catNameById.get(s.cat_id as string) ?? "",
              reporterName: user?.email ?? "",
              observedAt: s.observed_at as string,
            }),
          );
          await persistAlerts(svc, org.organisation_id, specs, recipients);
        }
      }
    } catch {
      // Swallow: the feeding update stands regardless of the alert fan-out.
    }
  }

  return NextResponse.json({ ok: true, id: input.id });
}
