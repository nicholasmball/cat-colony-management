import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { dayRangeInTz, minutesAfterWindow, todayInTz } from "@/lib/time";
import { alertRecipients, type AlertMembership } from "@/lib/alert-recipients";
import {
  planFeedingMissedAlerts,
  planNotSeenAlerts,
  type AlertSpec,
  type FeedingMissedColony,
  type NotSeenCat,
} from "@/lib/alert-engine";
import { persistAlerts } from "@/lib/alert-persist";
import { DEFAULT_FEEDING_MISSED_HOURS } from "@/lib/alert-settings";
import { PER_CAT_SIGHTING_CAP, capRowsPerKey } from "@/lib/dashboard";
import type { ConcernSighting, ConcernReview } from "@/lib/cat-concern";

// ── Scheduled alert sweep — the TIME-BASED half of the alert engine ──────────
// The event hooks (in the server actions) raise the "something just happened"
// alerts (new incident / new cat / concern sighting) inline. This route owns the
// rules that only a clock can detect: a colony's feeding window has now lapsed
// past the org threshold (feeding_missed), and a cat has now gone unseen long
// enough / often enough (not_seen, via concernCandidate). It is meant to be
// hit on a schedule (Supabase pg_cron + pg_net, ~every 15 min) with a bearer
// secret. Idempotent by construction: the planner dedups against existing keys
// AND the insert is ON CONFLICT (recipient_id, dedup_key) DO NOTHING, so a
// re-run never double-alerts.
//
// SCOPE: detection + record only. NO senders (push/SMS/email) are imported or
// called; dispatched_at is left NULL. Detection thresholds are NEVER re-derived
// here — feedingStatus/latestFedByColony and concernCandidate (via the pure
// planner) are the single source of truth.

export const dynamic = "force-dynamic";

// Backstop caps. Bounded, set-based reads — NO per-colony or per-cat query loop.
const SIGHTINGS_SCAN_CAP = 20000;
const REVIEWS_SCAN_CAP = 20000;
const EXISTING_KEYS_CAP = 50000;

type OrgRow = {
  id: string;
  timezone: string | null;
};

export async function POST(req: Request) {
  // ── Auth FIRST, before any DB work. A missing/empty CRON_SECRET must reject:
  // never allow an empty-secret bypass (Bearer "undefined"/"" can't match).
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  const now = new Date();

  // ── 1. All orgs (the sweep is cross-org; the service role bypasses RLS). ────
  const { data: orgData } = await svc
    .from("organisations")
    .select("id, timezone");
  const orgs = (orgData ?? []) as OrgRow[];
  if (orgs.length === 0) {
    return NextResponse.json({ inserted: 0, scanned: 0 });
  }
  const orgIds = orgs.map((o) => o.id);

  // ── 2. Batched, set-based reads across ALL orgs at once (no per-row loop) ───
  // Everything below is keyed/grouped in memory; the queries themselves are a
  // small fixed number regardless of org/colony/cat counts.
  const [coloniesRes, membershipsRes, settingsRes, catsRes, existingKeysRes] =
    await Promise.all([
      svc
        .from("colonies")
        .select("id, name, organisation_id, feeding_window_end")
        .in("organisation_id", orgIds)
        .eq("is_active", true)
        .is("deleted_at", null),
      // Recipient fan-out source: active caretakers + admins per org.
      svc
        .from("memberships")
        .select("organisation_id, user_id, role, deleted_at")
        .in("organisation_id", orgIds),
      // Per-org concern thresholds (defaults applied inside concernCandidate).
      svc
        .from("alert_settings")
        .select(
          "organisation_id, not_seen_days, repeated_not_seen, feeding_missed_hours",
        )
        .in("organisation_id", orgIds),
      // Every active cat across all orgs — basis for not_seen detection.
      svc
        .from("cats")
        .select("id, name, temp_id, colony_id, organisation_id, status")
        .in("organisation_id", orgIds)
        .is("deleted_at", null),
      // Already-raised keys so the planner can skip them up front (the unique
      // index is the hard guarantee; this just avoids building no-op rows).
      svc
        .from("notifications")
        .select("dedup_key")
        .in("organisation_id", orgIds)
        .limit(EXISTING_KEYS_CAP),
    ]);

  const colonies = (coloniesRes.data ?? []) as {
    id: string;
    name: string;
    organisation_id: string;
    feeding_window_end: string | null;
  }[];
  const cats = (catsRes.data ?? []) as {
    id: string;
    name: string | null;
    temp_id: string | null;
    colony_id: string;
    organisation_id: string;
    status: string;
  }[];

  // Today's feeding events per org's local day. A colony's "today" depends on
  // its org's timezone, so we widen the scan to the union of all orgs' day
  // ranges (one bounded query), then bucket by org locally. The planner re-checks
  // each colony against its own org-local window via minutesAfterClose.
  let minStart = Infinity;
  let maxEnd = -Infinity;
  for (const o of orgs) {
    const { startUtc, endUtc } = dayRangeInTz(o.timezone ?? "Europe/Lisbon");
    minStart = Math.min(minStart, startUtc.getTime());
    maxEnd = Math.max(maxEnd, endUtc.getTime());
  }
  const { data: feedsData } = await svc
    .from("feeding_events")
    .select("colony_id, organisation_id, observed_at, fed")
    .in("organisation_id", orgIds)
    .gte("observed_at", new Date(minStart).toISOString())
    .lt("observed_at", new Date(maxEnd).toISOString());
  const feeds = (feedsData ?? []) as {
    colony_id: string;
    organisation_id: string;
    observed_at: string;
    fed: boolean;
  }[];

  // ── 3. Group the batched rows by org (and cat) in memory ───────────────────
  const existing = new Set(
    (existingKeysRes.data ?? []).map((r) => r.dedup_key as string),
  );

  const settingsByOrg = new Map<
    string,
    {
      not_seen_days: number | null;
      repeated_not_seen: number | null;
      feeding_missed_hours: number | null;
    }
  >();
  for (const s of settingsRes.data ?? []) {
    settingsByOrg.set(s.organisation_id as string, {
      not_seen_days: (s.not_seen_days as number | null) ?? null,
      repeated_not_seen: (s.repeated_not_seen as number | null) ?? null,
      feeding_missed_hours: (s.feeding_missed_hours as number | null) ?? null,
    });
  }

  // Recipients per org (caretakers + admins, deduped) via the pure resolver.
  const membershipsByOrg = new Map<string, AlertMembership[]>();
  for (const m of membershipsRes.data ?? []) {
    const orgId = m.organisation_id as string;
    const list = membershipsByOrg.get(orgId) ?? [];
    list.push({
      user_id: m.user_id as string,
      role: m.role as string,
      deleted_at: (m.deleted_at as string | null) ?? null,
    });
    membershipsByOrg.set(orgId, list);
  }
  const recipientsByOrg = new Map<string, string[]>();
  for (const [orgId, list] of membershipsByOrg) {
    recipientsByOrg.set(orgId, alertRecipients(list));
  }

  const coloniesByOrg = new Map<string, typeof colonies>();
  for (const c of colonies) {
    const list = coloniesByOrg.get(c.organisation_id) ?? [];
    list.push(c);
    coloniesByOrg.set(c.organisation_id, list);
  }
  const feedsByOrg = new Map<string, typeof feeds>();
  for (const f of feeds) {
    const list = feedsByOrg.get(f.organisation_id) ?? [];
    list.push(f);
    feedsByOrg.set(f.organisation_id, list);
  }
  const catsByOrg = new Map<string, typeof cats>();
  for (const c of cats) {
    const list = catsByOrg.get(c.organisation_id) ?? [];
    list.push(c);
    catsByOrg.set(c.organisation_id, list);
  }
  const colonyNameById = new Map(colonies.map((c) => [c.id, c.name]));

  // ── 4. Per-cat sightings + reviews, capped PER CAT (mirrors the dashboard) ──
  // One bounded scan each; capRowsPerKey keeps the most-recent K per cat so a
  // busy colony can't starve a quieter cat's not-seen run.
  const allCatIds = cats.map((c) => c.id);
  const sightingsByCat = new Map<string, ConcernSighting[]>();
  const reviewsByCat = new Map<string, ConcernReview[]>();
  if (allCatIds.length > 0) {
    const [{ data: sightingData }, { data: reviewData }] = await Promise.all([
      svc
        .from("cat_sightings")
        .select("cat_id, status, observed_at")
        .in("cat_id", allCatIds)
        .order("cat_id", { ascending: true })
        .order("observed_at", { ascending: false })
        .limit(SIGHTINGS_SCAN_CAP),
      svc
        .from("cat_concern_reviews")
        .select("cat_id, outcome, created_at")
        .in("cat_id", allCatIds)
        .order("cat_id", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(REVIEWS_SCAN_CAP),
    ]);
    for (const [catId, list] of capRowsPerKey(
      sightingData ?? [],
      (r) => r.cat_id as string,
      PER_CAT_SIGHTING_CAP,
    )) {
      sightingsByCat.set(
        catId,
        list.map((s) => ({
          status: s.status as ConcernSighting["status"],
          observed_at: s.observed_at as string,
        })),
      );
    }
    for (const [catId, list] of capRowsPerKey(
      reviewData ?? [],
      (r) => r.cat_id as string,
      PER_CAT_SIGHTING_CAP,
    )) {
      reviewsByCat.set(
        catId,
        list.map((r) => ({
          outcome: r.outcome as ConcernReview["outcome"],
          created_at: r.created_at as string,
        })),
      );
    }
  }

  // ── 5. Plan + fan-out per org, then one batched insert ─────────────────────
  let inserted = 0;
  let scanned = 0;

  for (const org of orgs) {
    const tz = org.timezone ?? "Europe/Lisbon";
    const localDate = todayInTz(tz, now);
    const recipients = recipientsByOrg.get(org.id) ?? [];
    const orgColonies = coloniesByOrg.get(org.id) ?? [];
    const orgCats = catsByOrg.get(org.id) ?? [];
    scanned += orgColonies.length + orgCats.length;

    // No one to alert → skip planning entirely (still counted as scanned).
    if (recipients.length === 0) continue;

    const settings = settingsByOrg.get(org.id) ?? {
      not_seen_days: null,
      repeated_not_seen: null,
      feeding_missed_hours: null,
    };
    // Effective feeding-missed threshold: the org row, else the engine default.
    const feedingMissedHours =
      settings.feeding_missed_hours ?? DEFAULT_FEEDING_MISSED_HOURS;

    // feeding_missed: per colony, today's events vs the org-local window close.
    const feedingColonies: FeedingMissedColony[] = orgColonies.map((c) => ({
      colonyId: c.id,
      colonyName: c.name,
      minutesAfterClose: c.feeding_window_end
        ? minutesAfterWindow(c.feeding_window_end, tz, now)
        : null,
      // Drives both the message body AND detection (×60 inside feedingStatus).
      thresholdHours: feedingMissedHours,
    }));
    const feedingSpecs = planFeedingMissedAlerts(
      {
        colonies: feedingColonies,
        events: feedsByOrg.get(org.id) ?? [],
        localDate,
      },
      existing,
    );

    // not_seen / repeated: per cat, sightings + reviews vs the org thresholds.
    const notSeenCats: NotSeenCat[] = orgCats.map((c) => ({
      catId: c.id,
      colonyId: c.colony_id,
      colonyName: colonyNameById.get(c.colony_id) ?? "",
      catName: c.name?.trim() || c.temp_id?.trim() || "",
      status: c.status,
      sightings: sightingsByCat.get(c.id) ?? [],
      reviews: reviewsByCat.get(c.id) ?? [],
    }));
    const notSeenSpecs = planNotSeenAlerts(
      {
        cats: notSeenCats,
        thresholds: {
          not_seen_days: settings.not_seen_days,
          repeated_not_seen: settings.repeated_not_seen,
        },
        now,
      },
      existing,
    );

    const specs: AlertSpec[] = [...feedingSpecs, ...notSeenSpecs];
    if (specs.length === 0) continue;

    inserted += await persistAlerts(svc, org.id, specs, recipients);
  }

  return NextResponse.json({ inserted, scanned });
}
