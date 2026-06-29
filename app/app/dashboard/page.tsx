import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/active-org";
import { dayRangeInTz } from "@/lib/time";
import { type FeedingStatus } from "@/lib/feeding-status";
import { colonyWindowStatuses, windowRangeLabel } from "@/lib/feeding-windows";
import { getWindowsByColony } from "../colonies/feeding-windows";
import {
  concernCandidate,
  concernReasonKey,
  type ConcernSighting,
  type ConcernReview,
} from "@/lib/cat-concern";
import { DEFAULT_FEEDING_MISSED_HOURS } from "@/lib/alert-settings";
import { UNCONFIRMED_STATUS } from "@/lib/cat-report";
import { catLabel } from "@/lib/cat-display";
import { summariseTodayFeeds, isDashboardAllClear } from "@/lib/dashboard";
import {
  CalendarIcon,
  ChevronIcon,
  PawIcon,
  WarningIcon,
  IncidentTypeIcon,
  GridIcon,
} from "@/components/icons";
import {
  IncidentStatusPill,
  UrgentBadge,
} from "@/components/incident-status-pill";
import { card } from "@/lib/ui";

// Top-N cap for each section's list — overflow rolls into a "View all →" link.
const TOP_N = 5;

const toneClass: Record<string, string> = {
  good: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  warn: "bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  bad: "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300",
  neutral: "bg-foreground/5 text-muted",
};

// Feed-status pill styling — lifted verbatim from app/app/today so the summary
// reads identically to the Today screen it links into. Icon + word, never
// colour alone (WCAG 1.4.1).
const feedTone: Record<FeedingStatus, string> = {
  fed: toneClass.good,
  pending: toneClass.neutral,
  missed: toneClass.bad,
};

function FeedGlyph({ status }: { status: FeedingStatus }) {
  if (status === "fed") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="h-3.5 w-3.5"
      >
        <path d="m5 12.5 4.5 4.5L19 7" />
      </svg>
    );
  }
  if (status === "missed") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="h-3.5 w-3.5"
      >
        <path d="M12 9v4M12 17h.01" />
        <path d="M10.3 3.9 2.4 17.5a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className="h-2.5 w-2.5"
    >
      <circle cx="12" cy="12" r="6" />
    </svg>
  );
}

// ── Small presentational primitives (compose the existing tokens; no new UI
// system). Each section card pairs a metric, a top-N list and an all-clear. ──

function SectionCard({
  title,
  icon,
  badge,
  span,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  badge?: { tone: "warn" | "bad"; value: number } | null;
  span?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`${card} flex flex-col gap-1 p-4 ${span ? "md:col-span-2" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
          <span className="text-muted">{icon}</span>
          {title}
        </h2>
        {badge ? (
          <span
            className={`grid min-w-[22px] place-items-center rounded-full px-1.5 py-0.5 text-xs font-bold ${toneClass[badge.tone]}`}
          >
            {badge.value}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

// Per-section all-clear block — a compact, reassuring "good" variant (the page
// also has its own whole-page all-clear when EVERY section is empty).
function SectionAllClear({
  good,
  title,
  body,
}: {
  good?: boolean;
  title: string;
  body: string;
}) {
  return (
    <div className="mt-2 flex flex-col items-center gap-1 rounded-lg border border-dashed border-border px-4 py-5 text-center">
      <span
        aria-hidden
        className={`grid h-10 w-10 place-items-center rounded-full ${
          good ? toneClass.good : "bg-accent/10 text-accent"
        }`}
      >
        {good ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
          >
            <path d="m5 12.5 4.5 4.5L19 7" />
          </svg>
        ) : (
          <PawIcon className="h-5 w-5" />
        )}
      </span>
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-xs text-xs text-muted">{body}</p>
    </div>
  );
}

function ViewAllLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-accent hover:underline"
    >
      {label} →
    </Link>
  );
}

// One row PER feeding window (design nit #3: the missed tally counts windows,
// not colonies — a colony fed in the morning but missed at night surfaces the
// evening slot only). A colony with no windows is a single "No window" unit.
type FeedRow = {
  colonyId: string;
  colonyName: string;
  windowStart: string | null;
  windowEnd: string | null;
  status: FeedingStatus;
};

export default async function DashboardPage() {
  // Guard — mirror app/app/incidents/page.tsx. Read-only manager oversight.
  const org = await getActiveOrg();
  if (!org) redirect("/app");
  if (org.role !== "admin" && org.role !== "caretaker") redirect("/app/today");

  const t = await getTranslations("dashboard");
  const tType = await getTranslations("incidents.type");
  const tCommon = await getTranslations("common");
  const tConcern = await getTranslations();
  const locale = await getLocale();
  const displayLocale = locale === "pt" ? "pt-PT" : "en-GB";
  const concernText = (flag: {
    reason: "concern" | "not_seen_days" | "repeated_not_seen";
    count: number;
  }) => tConcern(concernReasonKey(flag.reason), { count: flag.count });

  const supabase = await createClient();
  const dayRange = dayRangeInTz(org.timezone);
  const now = new Date();

  // ── Fan out the section reads concurrently. Every query is org-scoped and
  // bounded — no per-row fan-out, no unbounded SELECTs. ──────────────────────
  const [
    coloniesResult,
    feedsResult,
    newCatsResult,
    catsResult,
    levelsResult,
    settingsResult,
  ] = await Promise.all([
    // (1+2) all active colonies + (1) today's feeding events — the Today pattern.
    supabase
      .from("colonies")
      .select("id, name")
      .eq("organisation_id", org.organisation_id)
      .eq("is_active", true)
      .is("deleted_at", null),
    supabase
      .from("feeding_events")
      .select("colony_id, observed_at, fed")
      .eq("organisation_id", org.organisation_id)
      .gte("observed_at", dayRange.startUtc.toISOString())
      .lt("observed_at", dayRange.endUtc.toISOString()),
    // (3) cats awaiting confirm/reject — the New queue.
    supabase
      .from("cats")
      .select("id, name, temp_id, colony_id, created_at")
      .eq("organisation_id", org.organisation_id)
      .eq("status", UNCONFIRMED_STATUS)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    // (5) every active cat — basis for org-wide concern detection.
    supabase
      .from("cats")
      .select("id, name, temp_id, colony_id, status")
      .eq("organisation_id", org.organisation_id)
      .is("deleted_at", null),
    // (4) urgency levels — which level ids alert immediately (= urgent).
    supabase
      .from("incident_urgency_levels")
      .select("id, alerts_immediately")
      .eq("organisation_id", org.organisation_id),
    // (5) org alert thresholds (defaults applied in concernCandidate).
    supabase
      .from("alert_settings")
      .select("not_seen_days, repeated_not_seen, feeding_missed_hours")
      .eq("organisation_id", org.organisation_id)
      .maybeSingle(),
  ]);

  // ── Section 1 + 2: Today's feeds & missed feeds (PER WINDOW) ────────────────
  const colonies = (coloniesResult.data ?? []) as {
    id: string;
    name: string;
  }[];
  // Effective feeding-missed threshold in minutes: the org's row, else default.
  const missedAfterMin =
    ((settingsResult.data?.feeding_missed_hours as number | null) ??
      DEFAULT_FEEDING_MISSED_HOURS) * 60;
  // One batched windows read + today's events grouped by colony in memory.
  const windowsByColony = await getWindowsByColony(
    supabase,
    colonies.map((c) => c.id),
    org.organisation_id,
  );
  const feedsByColony = new Map<
    string,
    { observed_at: string; fed: boolean }[]
  >();
  for (const f of feedsResult.data ?? []) {
    const list = feedsByColony.get(f.colony_id) ?? [];
    list.push({ observed_at: f.observed_at, fed: f.fed });
    feedsByColony.set(f.colony_id, list);
  }
  const feedRows: FeedRow[] = colonies.flatMap((c) => {
    const windows = colonyWindowStatuses(
      windowsByColony.get(c.id) ?? [],
      feedsByColony.get(c.id) ?? [],
      org.timezone,
      now,
      missedAfterMin,
    );
    if (windows.length === 0) {
      // No windows → a single pending "No window" unit (legacy parity).
      return [
        {
          colonyId: c.id,
          colonyName: c.name,
          windowStart: null,
          windowEnd: null,
          status: "pending" as FeedingStatus,
        },
      ];
    }
    return windows.map((w) => ({
      colonyId: c.id,
      colonyName: c.name,
      windowStart: w.start,
      windowEnd: w.end,
      status: w.status,
    }));
  });
  const feedCounts = summariseTodayFeeds(feedRows.map((r) => r.status));
  const missedRows = feedRows
    .filter((r) => r.status === "missed")
    .sort((a, b) => (a.windowStart ?? "").localeCompare(b.windowStart ?? ""));

  // Colony name map (reused by new-cat + concern sections) — built from the
  // already-fetched active colonies; only inactive/edge colonies need a backfill.
  const colonyName = new Map(colonies.map((c) => [c.id, c.name]));

  // ── Section 3: new cat reports ─────────────────────────────────────────────
  const newCats = (newCatsResult.data ?? []) as {
    id: string;
    name: string | null;
    temp_id: string | null;
    colony_id: string;
    created_at: string;
  }[];

  // ── Section 4: urgent incidents ────────────────────────────────────────────
  const urgentLevelIds = new Set(
    (levelsResult.data ?? [])
      .filter((l) => l.alerts_immediately)
      .map((l) => l.id as string),
  );
  // Never pass an empty list into .in() (errors in Postgres): if the org has no
  // urgent level, there can be no urgent incidents — skip the query entirely.
  type IncidentRow = {
    id: string;
    type: string;
    status: string;
    colony_id: string;
    cat_id: string | null;
    occurred_at: string;
  };
  let urgentIncidents: IncidentRow[] = [];
  if (urgentLevelIds.size > 0) {
    const { data } = await supabase
      .from("incidents")
      .select("id, type, status, colony_id, cat_id, occurred_at")
      .eq("organisation_id", org.organisation_id)
      .in("status", ["open", "in_progress"])
      .in("urgency_level_id", [...urgentLevelIds])
      .order("occurred_at", { ascending: false });
    urgentIncidents = (data ?? []) as IncidentRow[];
  }

  // ── Section 5: cats not seen / concern (org-wide) ──────────────────────────
  const cats = (catsResult.data ?? []) as {
    id: string;
    name: string | null;
    temp_id: string | null;
    colony_id: string;
    status: string;
  }[];
  const catIds = cats.map((c) => c.id);
  const notSeenDays =
    (settingsResult.data?.not_seen_days as number | null) ?? null;
  const repeatedNotSeen =
    (settingsResult.data?.repeated_not_seen as number | null) ?? null;

  // CONDITION 1 (load-bearing — per-cat-safe): read the per-cat "most recent K"
  // views (migration 0010), NOT the raw tables. Each view applies
  // row_number() over (partition by cat_id order by <time> desc) <= K in
  // Postgres, so the per-cat bound (K = PER_CAT_SIGHTING_CAP, 10) happens at the
  // source. The OLD approach paged the raw tables with a single GLOBAL
  // .limit(5000) then capped per cat in memory via capRowsPerKey — but that
  // global ceiling truncated by cat_id UUID order, so once an org passed ~5000
  // sighting rows a high-UUID cat's not-seen rows could be cut before the
  // per-cat cap ever saw them, silently dropping a quiet cat from the roll-up.
  // The views remove that ceiling entirely while preserving org-scoping
  // (security_invoker = on → the caller's base-table RLS still applies). We keep
  // the explicit .in(catIds) + .order() so "most recent" stays well-defined and
  // the partitioning indexes are used. capRowsPerKey is now redundant (the view
  // already bounds per cat) and is dropped here. concernCandidate is unchanged.
  const sightingsByCat = new Map<string, ConcernSighting[]>();
  const reviewsByCat = new Map<string, ConcernReview[]>();
  if (catIds.length > 0) {
    const [{ data: sightingData }, { data: reviewData }] = await Promise.all([
      supabase
        .from("cat_recent_sightings")
        .select("cat_id, status, observed_at")
        .eq("organisation_id", org.organisation_id)
        .in("cat_id", catIds)
        .order("observed_at", { ascending: false }),
      supabase
        .from("cat_recent_concern_reviews")
        .select("cat_id, outcome, created_at")
        .eq("organisation_id", org.organisation_id)
        .in("cat_id", catIds)
        .order("created_at", { ascending: false }),
    ]);
    for (const s of sightingData ?? []) {
      const catId = s.cat_id as string;
      const list = sightingsByCat.get(catId);
      const row: ConcernSighting = {
        status: s.status as ConcernSighting["status"],
        observed_at: s.observed_at as string,
      };
      if (list) list.push(row);
      else sightingsByCat.set(catId, [row]);
    }
    for (const r of reviewData ?? []) {
      const catId = r.cat_id as string;
      const list = reviewsByCat.get(catId);
      const row: ConcernReview = {
        outcome: r.outcome as ConcernReview["outcome"],
        created_at: r.created_at as string,
      };
      if (list) list.push(row);
      else reviewsByCat.set(catId, [row]);
    }
  }
  const concernCats = cats
    .map((c) => ({
      cat: c,
      flag: concernCandidate({
        status: c.status,
        sightings: sightingsByCat.get(c.id) ?? [],
        reviews: reviewsByCat.get(c.id) ?? [],
        thresholds: {
          not_seen_days: notSeenDays,
          repeated_not_seen: repeatedNotSeen,
        },
        now,
      }),
    }))
    .filter(
      (
        x,
      ): x is {
        cat: (typeof cats)[number];
        flag: NonNullable<ReturnType<typeof concernCandidate>>;
      } => x.flag !== null,
    );
  // Headline = actionable (not monitoring); Monitoring is a distinct sub-count.
  const activeConcern = concernCats.filter((x) => !x.flag.monitoring);
  const monitoringCount = concernCats.length - activeConcern.length;

  // ── Backfill any colony names missing from the active-colonies map (cats /
  // incidents can reference an inactive colony). One bounded batched query. ──
  const referencedColonyIds = [
    ...new Set([
      ...newCats.map((c) => c.colony_id),
      ...urgentIncidents.map((i) => i.colony_id),
      ...activeConcern.map((x) => x.cat.colony_id),
    ]),
  ].filter((id) => !colonyName.has(id));
  if (referencedColonyIds.length > 0) {
    const { data } = await supabase
      .from("colonies")
      .select("id, name")
      .in("id", referencedColonyIds);
    for (const c of data ?? []) colonyName.set(c.id, c.name);
  }

  // Cat names for urgent incidents that reference a specific cat — reuse the
  // already-fetched active cats; only truly missing ids need a backfill.
  const catNameById = new Map(cats.map((c) => [c.id, catLabel(c)]));
  const missingCatIds = [
    ...new Set(
      urgentIncidents
        .map((i) => i.cat_id)
        .filter((v): v is string => !!v && !catNameById.has(v)),
    ),
  ];
  if (missingCatIds.length > 0) {
    const { data } = await supabase
      .from("cats")
      .select("id, name, temp_id")
      .in("id", missingCatIds);
    for (const c of data ?? []) catNameById.set(c.id, catLabel(c));
  }

  // ── Whole-page all-clear reducer ───────────────────────────────────────────
  const allClear = isDashboardAllClear({
    missedFeeds: missedRows.length,
    newCatReports: newCats.length,
    urgentIncidents: urgentIncidents.length,
    concernCats: activeConcern.length,
  });

  const dateLabel = new Intl.DateTimeFormat(displayLocale, {
    timeZone: org.timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(now);

  const timeFmt = new Intl.DateTimeFormat(displayLocale, {
    timeZone: org.timezone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const colonyCount = colonies.length;

  return (
    <div className="flex flex-col gap-5 px-6 py-6 md:px-10">
      <div>
        <h1 className="flex items-center gap-2 font-display text-3xl">
          <GridIcon className="h-7 w-7 text-accent" aria-hidden />
          {t("title")}
        </h1>
        <p className="text-sm text-muted">
          {dateLabel} · {org.name}
          {colonyCount > 0
            ? ` · ${t("colonyCount", { count: colonyCount })}`
            : ""}
        </p>
      </div>

      {allClear ? (
        // Whole-page all-clear: every actionable section is empty.
        <div
          className={`${card} flex flex-col items-center gap-2 px-6 py-10 text-center`}
        >
          <span
            aria-hidden
            className={`grid h-16 w-16 place-items-center rounded-full ${toneClass.good}`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-8 w-8"
            >
              <path d="m5 12.5 4.5 4.5L19 7" />
            </svg>
          </span>
          <h2 className="font-display text-xl">
            {t("allClearTitle", { count: colonyCount })}
          </h2>
          <p className="max-w-md text-sm text-muted">{t("allClearBody")}</p>
          <ViewAllLink href="/app/today" label={t("viewToday")} />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {/* ── 1. Today's feeds (spans both columns — the daily anchor) ── */}
          <SectionCard
            title={t("todaysFeeds")}
            span
            icon={<CalendarIcon className="h-4 w-4" aria-hidden />}
          >
            {feedCounts.total === 0 ? (
              <SectionAllClear
                title={t("feedsEmptyTitle")}
                body={t("feedsEmptyBody")}
              />
            ) : (
              <>
                <div className="mt-1 flex flex-wrap gap-2">
                  {(["fed", "pending", "missed"] as FeedingStatus[]).map(
                    (s) => (
                      <span
                        key={s}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${feedTone[s]}`}
                      >
                        <FeedGlyph status={s} />
                        {t("feedStatus", {
                          count: feedCounts[s],
                          status: t(`feedStatusWord.${s}`),
                        })}
                      </span>
                    ),
                  )}
                </div>
                <ViewAllLink href="/app/today" label={t("viewToday")} />
              </>
            )}
          </SectionCard>

          {/* ── 2. Missed feeds (act now) ── */}
          <SectionCard
            title={t("missedFeeds")}
            icon={<CalendarIcon className="h-4 w-4" aria-hidden />}
            badge={
              missedRows.length > 0
                ? { tone: "bad", value: missedRows.length }
                : null
            }
          >
            {missedRows.length === 0 ? (
              <SectionAllClear
                good
                title={t("missedEmptyTitle")}
                body={t("missedEmptyBody")}
              />
            ) : (
              <>
                <ul className="mt-2 flex flex-col gap-2">
                  {missedRows.slice(0, TOP_N).map((r, i) => (
                    <li key={`${r.colonyId}-${i}`}>
                      <Link
                        href={`/app/colonies/${r.colonyId}/feed`}
                        className={`${card} flex min-h-[56px] items-center gap-3 border-l-4 border-l-red-500 px-4 py-3 transition hover:bg-foreground/5`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{r.colonyName}</p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                            <span className="tabular-nums">
                              {windowRangeLabel(r.windowStart, r.windowEnd) ||
                                t("noWindow")}
                            </span>
                            <span aria-hidden>·</span>
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${feedTone.missed}`}
                            >
                              <FeedGlyph status="missed" />
                              {t("missed")}
                            </span>
                          </p>
                        </div>
                        <span className="shrink-0 text-sm font-semibold text-accent">
                          {t("feedArrow")}
                        </span>
                        <ChevronIcon className="h-4 w-4 shrink-0 text-muted" />
                      </Link>
                    </li>
                  ))}
                </ul>
                {missedRows.length > TOP_N ? (
                  <ViewAllLink href="/app/today" label={t("viewToday")} />
                ) : null}
              </>
            )}
          </SectionCard>

          {/* ── 4. Urgent incidents (act now) ── */}
          <SectionCard
            title={t("urgentIncidents")}
            icon={<WarningIcon className="h-4 w-4" aria-hidden />}
            badge={
              urgentIncidents.length > 0
                ? { tone: "bad", value: urgentIncidents.length }
                : null
            }
          >
            {urgentIncidents.length === 0 ? (
              <SectionAllClear
                good
                title={t("urgentEmptyTitle")}
                body={t("urgentEmptyBody")}
              />
            ) : (
              <>
                <ul className="mt-2 flex flex-col gap-2">
                  {urgentIncidents.slice(0, TOP_N).map((i) => (
                    <li key={i.id}>
                      <Link
                        href={`/app/incidents/${i.id}`}
                        className={`${card} flex min-h-[56px] items-center gap-3 px-4 py-3 transition hover:bg-foreground/5 ${
                          i.status === "open"
                            ? "border-l-4 border-l-red-500"
                            : ""
                        }`}
                      >
                        <IncidentTypeIcon
                          type={i.type}
                          className="h-5 w-5 shrink-0 text-muted"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                            <span className="truncate">{tType(i.type)}</span>
                            <UrgentBadge />
                            <IncidentStatusPill status={i.status} />
                          </p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                            <span className="truncate">
                              {colonyName.get(i.colony_id) ?? tCommon("colony")}
                            </span>
                            {i.cat_id && catNameById.get(i.cat_id) ? (
                              <>
                                <span aria-hidden>·</span>
                                <span className="truncate">
                                  {catNameById.get(i.cat_id)}
                                </span>
                              </>
                            ) : null}
                            <span aria-hidden>·</span>
                            <span>
                              {timeFmt.format(new Date(i.occurred_at))}
                            </span>
                          </p>
                        </div>
                        <ChevronIcon className="h-4 w-4 shrink-0 text-muted" />
                      </Link>
                    </li>
                  ))}
                </ul>
                {urgentIncidents.length > TOP_N ? (
                  <ViewAllLink
                    href="/app/incidents?urgent=1"
                    label={t("viewAllUrgent")}
                  />
                ) : null}
              </>
            )}
          </SectionCard>

          {/* ── 3. New cat reports ── */}
          <SectionCard
            title={t("newCatReports")}
            icon={<PawIcon className="h-4 w-4" aria-hidden />}
            badge={
              newCats.length > 0
                ? { tone: "warn", value: newCats.length }
                : null
            }
          >
            {newCats.length === 0 ? (
              <SectionAllClear
                title={t("newCatsEmptyTitle")}
                body={t("newCatsEmptyBody")}
              />
            ) : (
              <>
                <ul className="mt-2 flex flex-col gap-2">
                  {newCats.slice(0, TOP_N).map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/app/colonies/${c.colony_id}/cats/${c.id}`}
                        className={`${card} flex min-h-[56px] items-center gap-3 border-l-4 border-l-accent px-4 py-3 transition hover:bg-foreground/5`}
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border bg-surface">
                          <PawIcon className="h-5 w-5 text-muted" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-1.5 font-medium">
                            <span className="truncate">{catLabel(c)}</span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${toneClass.neutral} text-accent`}
                            >
                              {t("newUnconfirmed")}
                            </span>
                          </p>
                          <p className="mt-0.5 truncate text-xs text-muted">
                            {colonyName.get(c.colony_id) ?? tCommon("colony")}
                          </p>
                        </div>
                        <span className="shrink-0 text-sm font-semibold text-accent">
                          {t("confirmArrow")}
                        </span>
                        <ChevronIcon className="h-4 w-4 shrink-0 text-muted" />
                      </Link>
                    </li>
                  ))}
                </ul>
                {newCats.length > TOP_N ? (
                  <p className="mt-2 text-sm text-muted">
                    {t("moreAwaitingReview", { count: newCats.length - TOP_N })}
                  </p>
                ) : null}
              </>
            )}
          </SectionCard>

          {/* ── 5. Cats not seen / concern ── */}
          <SectionCard
            title={t("concern")}
            icon={<WarningIcon className="h-4 w-4" aria-hidden />}
            badge={
              activeConcern.length > 0
                ? { tone: "warn", value: activeConcern.length }
                : null
            }
          >
            {activeConcern.length === 0 ? (
              <>
                <SectionAllClear
                  good
                  title={t("concernEmptyTitle")}
                  body={t("concernEmptyBody")}
                />
                {monitoringCount > 0 ? (
                  <p className="mt-2 text-xs text-muted">
                    {t("underMonitoring", { count: monitoringCount })}
                  </p>
                ) : null}
              </>
            ) : (
              <>
                {monitoringCount > 0 ? (
                  <p className="mt-1 text-xs text-muted">
                    {t("monitoringPlus", { count: monitoringCount })}
                  </p>
                ) : null}
                <ul className="mt-2 flex flex-col gap-2">
                  {activeConcern.slice(0, TOP_N).map(({ cat: c, flag }) => (
                    <li key={c.id}>
                      <Link
                        href={`/app/colonies/${c.colony_id}/cats/${c.id}`}
                        className={`${card} flex min-h-[56px] items-center gap-3 border-l-4 border-l-amber-400 px-4 py-3 transition hover:bg-foreground/5`}
                      >
                        <WarningIcon
                          className="h-5 w-5 shrink-0 text-amber-500"
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{catLabel(c)}</p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${toneClass.warn}`}
                            >
                              <WarningIcon className="h-3 w-3" aria-hidden />
                              {concernText(flag)}
                            </span>
                            <span aria-hidden>·</span>
                            <span className="truncate">
                              {colonyName.get(c.colony_id) ?? tCommon("colony")}
                            </span>
                          </p>
                        </div>
                        <ChevronIcon className="h-4 w-4 shrink-0 text-muted" />
                      </Link>
                    </li>
                  ))}
                </ul>
                {activeConcern.length > TOP_N ? (
                  <p className="mt-2 text-sm text-muted">
                    {t("moreNeedReview", {
                      count: activeConcern.length - TOP_N,
                    })}
                  </p>
                ) : null}
              </>
            )}
          </SectionCard>
        </div>
      )}
    </div>
  );
}
