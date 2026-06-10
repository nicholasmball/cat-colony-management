import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/active-org";
import { photoSrc } from "@/lib/photo";
import { catLabel, formatStatus, statusTone } from "@/lib/cat-display";
import { UNCONFIRMED_STATUS, compareCatsForList } from "@/lib/cat-report";
import {
  collectUserIds,
  buildFeedingSection,
  buildIncidentSection,
  lastFedFromRows,
  type RawFeedingEvent,
  type RawIncident,
  type FeedingFlag,
} from "@/lib/colony-history";
import {
  concernCandidate,
  concernReasonKey,
  type ConcernSighting,
  type ConcernReview,
} from "@/lib/cat-concern";
import { scheduleWhen } from "@/lib/schedule";
import { createServiceClient } from "@/lib/supabase/service";
import {
  PawIcon,
  ChevronIcon,
  CalendarIcon,
  WarningIcon,
  IncidentTypeIcon,
} from "@/components/icons";
import {
  IncidentStatusPill,
  UrgentBadge,
} from "@/components/incident-status-pill";
import { EmptyState } from "@/components/empty-state";
import { ConfirmButton } from "@/components/confirm-button";
import { deleteSchedule } from "./schedules/actions";
import { btnGhost, btnGhostDanger, btnPrimary, card, pill } from "@/lib/ui";

const errorClass =
  "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300";

const toneClass: Record<string, string> = {
  good: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  warn: "bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  bad: "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300",
  neutral: "bg-foreground/5 text-muted",
};

type Cat = {
  id: string;
  name: string | null;
  temp_id: string | null;
  colour: string | null;
  status: string;
  photo_url: string | null;
};

type Schedule = {
  id: string;
  feeder_id: string | null;
  weekday: number | null;
  specific_date: string | null;
  approx_time: string | null;
  notes: string | null;
};

function hhmm(t: string | null) {
  return t ? t.slice(0, 5) : null;
}

export default async function ColonyDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    updated?: string;
    error?: string;
    reported?: string;
    photo?: string;
    confirmed?: string;
    rejected?: string;
  }>;
}) {
  const { id } = await params;
  const { updated, error, reported, photo, confirmed, rejected } =
    await searchParams;
  const t = await getTranslations("colonies");
  const tc = await getTranslations("common");
  const tCat = await getTranslations("cats");
  const tType = await getTranslations("incidents.type");
  const tFeed = await getTranslations("feed");
  const tConcern = await getTranslations();
  const locale = await getLocale();
  const displayLocale = locale === "pt" ? "pt-PT" : "en-GB";
  const org = await getActiveOrg();
  const supabase = await createClient();
  // Translate a concern flag (reason + count) via the pure key mapper.
  const concernText = (flag: {
    reason: "concern" | "not_seen_days" | "repeated_not_seen";
    count: number;
  }) => tConcern(concernReasonKey(flag.reason), { count: flag.count });

  const { data: colony } = await supabase
    .from("colonies")
    .select(
      "id, name, notes, is_active, feeding_window_start, feeding_window_end",
    )
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!colony) notFound();

  const { data: catsData } = await supabase
    .from("cats")
    .select("id, name, temp_id, colour, status, photo_url")
    .eq("colony_id", id)
    .is("deleted_at", null)
    .order("name", { nullsFirst: false });
  // Derived ordering only (nothing stored): unconfirmed cats float to the top so
  // review work is visible, then alphabetical. Pure + tested comparator.
  const cats = ((catsData ?? []) as Cat[]).slice().sort(compareCatsForList);

  // Presigned thumbnail URL per cat (null → paw-icon fallback).
  const photos = new Map<string, string | null>(
    await Promise.all(
      cats.map(
        async (c) =>
          [c.id, await photoSrc(c.photo_url, org?.organisation_id ?? "")] as [
            string,
            string | null,
          ],
      ),
    ),
  );

  const canManage = org?.role === "admin" || org?.role === "caretaker";

  // ── Cats of concern (human-review queue) ───────────────────────────────────
  // Detect candidates WITHOUT N+1: one bounded sightings query for ALL of this
  // colony's cats, one alert_settings read, one concern-reviews read — then the
  // pure concernCandidate() helper runs per cat in memory. We bound the sightings
  // query so a long-lived colony can't pull an unbounded history; the helper only
  // needs each cat's recent run, and rows arrive newest-first.
  const catIds = cats.map((c) => c.id);
  const sightingsByCat = new Map<string, ConcernSighting[]>();
  const reviewsByCat = new Map<string, ConcernReview[]>();
  let notSeenDays: number | null = null;
  let repeatedNotSeen: number | null = null;
  if (catIds.length > 0 && org) {
    const [{ data: sightingData }, { data: reviewData }, { data: settings }] =
      await Promise.all([
        supabase
          .from("cat_sightings")
          .select("cat_id, status, observed_at")
          .in("cat_id", catIds)
          .order("observed_at", { ascending: false })
          .limit(500),
        supabase
          .from("cat_concern_reviews")
          .select("cat_id, outcome, created_at")
          .in("cat_id", catIds)
          .order("created_at", { ascending: false })
          .limit(500),
        supabase
          .from("alert_settings")
          .select("not_seen_days, repeated_not_seen")
          .eq("organisation_id", org.organisation_id)
          .maybeSingle(),
      ]);
    for (const s of sightingData ?? []) {
      const list = sightingsByCat.get(s.cat_id as string) ?? [];
      list.push({
        status: s.status as ConcernSighting["status"],
        observed_at: s.observed_at as string,
      });
      sightingsByCat.set(s.cat_id as string, list);
    }
    for (const r of reviewData ?? []) {
      const list = reviewsByCat.get(r.cat_id as string) ?? [];
      list.push({
        outcome: r.outcome as ConcernReview["outcome"],
        created_at: r.created_at as string,
      });
      reviewsByCat.set(r.cat_id as string, list);
    }
    notSeenDays = (settings?.not_seen_days as number | null) ?? null;
    repeatedNotSeen = (settings?.repeated_not_seen as number | null) ?? null;
  }
  const now = new Date();
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
        cat: Cat;
        flag: NonNullable<ReturnType<typeof concernCandidate>>;
      } => x.flag !== null,
    );
  // Active (not-yet-reviewed) candidates first; Monitoring is a distinct group.
  const activeConcern = concernCats.filter((x) => !x.flag.monitoring);
  const monitoringConcern = concernCats.filter((x) => x.flag.monitoring);

  const start = hhmm(colony.feeding_window_start);
  const end = hhmm(colony.feeding_window_end);

  // Active schedules for this colony, ordered weekday then date.
  const { data: scheduleData } = await supabase
    .from("feeding_schedules")
    .select("id, feeder_id, weekday, specific_date, approx_time, notes")
    .eq("colony_id", id)
    .is("deleted_at", null)
    .order("weekday", { nullsFirst: false })
    .order("specific_date", { nullsFirst: false });
  const schedules = (scheduleData ?? []) as Schedule[];

  // ── Two bounded history reads (RLS client, members-read-in-org) ────────────
  // Recent feeding updates + ALL-status incidents for this colony, newest-first.
  // LIMIT 11 so the pure helpers flag "older not shown" without a count query.
  // The incidents read intentionally drops the open/in_progress filter (the old
  // "open incidents" section) so the timeline shows resolved/closed too; we add
  // reported_by for the (GDPR-silent) attribution line.
  const [{ data: feedingData }, { data: incidentData }] = await Promise.all([
    supabase
      .from("feeding_events")
      .select("fed, problem, food_issue, danger, notes, feeder_id, observed_at")
      .eq("colony_id", id)
      .order("observed_at", { ascending: false })
      .limit(11),
    supabase
      .from("incidents")
      .select(
        "id, type, status, cat_id, urgency_level_id, reported_by, occurred_at",
      )
      .eq("colony_id", id)
      .order("occurred_at", { ascending: false })
      .limit(11),
  ]);
  const rawFeedings = (feedingData ?? []) as RawFeedingEvent[];
  const rawIncidents = (incidentData ?? []) as RawIncident[];

  // Urgency badge: which of the org's levels alert immediately. One read.
  const urgentLevelIds = new Set<string>();
  if (rawIncidents.length > 0 && org) {
    const { data: levelData } = await supabase
      .from("incident_urgency_levels")
      .select("id, alerts_immediately")
      .eq("organisation_id", org.organisation_id);
    for (const l of levelData ?? []) {
      if (l.alerts_immediately) urgentLevelIds.add(l.id as string);
    }
  }
  const catNameById = new Map(cats.map((c) => [c.id, catLabel(c)]));

  // ── Batched who-resolution (no N+1) ────────────────────────────────────────
  // One id-set across schedules (which keep their "unknown" fallback) AND the
  // two history lists (feeder_id + reported_by). Still ONE getUserById per
  // DISTINCT id via the service client; history rows just join the same batch.
  const userEmails = new Map<string, string>();
  const scheduleFeederIds = new Set(
    schedules.map((s) => s.feeder_id).filter((v): v is string => !!v),
  );
  const allUserIds = new Set<string>([
    ...scheduleFeederIds,
    ...collectUserIds(rawFeedings, rawIncidents),
  ]);
  if (allUserIds.size > 0) {
    const svc = createServiceClient();
    await Promise.all(
      [...allUserIds].map(async (uid) => {
        const { data } = await svc.auth.admin.getUserById(uid);
        // Only record a real email — a missing/deleted account leaves the id
        // unmapped so history attributionEmail() degrades to NO name (silent,
        // GDPR-safe), while schedules apply their own "unknown" fallback below.
        if (data.user?.email) userEmails.set(uid, data.user.email);
      }),
    );
  }

  // Shape the two history sections + last-fed off the email map (pure helpers).
  const feedingSection = buildFeedingSection(rawFeedings, userEmails);
  const incidentSection = buildIncidentSection(rawIncidents, userEmails);
  const lastFed = lastFedFromRows(rawFeedings);

  // org.timezone — there is NO colonies.timezone column. Mirrors the incident
  // page formatter; falls back to UTC so a render never throws.
  const dateTimeFmt = new Intl.DateTimeFormat(displayLocale, {
    timeZone: org?.timezone ?? "UTC",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const feedingFlagLabel: Record<FeedingFlag, string> = {
    problem: tFeed("flagProblem"),
    food_issue: tFeed("flagFoodIssue"),
    danger: tFeed("flagDanger"),
  };

  return (
    <div className="flex max-w-3xl flex-col gap-6 px-6 py-6 md:px-10">
      <Link href="/app/colonies" className="text-sm text-accent">
        {t("backToColonies")}
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">{colony.name}</h1>
          <p className="text-sm text-muted">
            {start
              ? t("feedsAt", { time: `${start}${end ? `–${end}` : ""}` })
              : t("noFeedingWindow")}
            {!colony.is_active ? ` · ${tc("inactive")}` : ""}
          </p>
          <p className="mt-0.5 text-sm font-medium">
            {lastFed.fedAt
              ? t("lastFed", {
                  when: dateTimeFmt.format(new Date(lastFed.fedAt)),
                })
              : t("notFedYet")}
          </p>
        </div>
        {canManage ? (
          <Link
            href={`/app/colonies/${id}/edit`}
            className={`${btnGhost} text-sm`}
          >
            {tc("edit")}
          </Link>
        ) : null}
      </div>

      {colony.notes ? (
        <p className={`${card} p-4 text-sm`}>{colony.notes}</p>
      ) : null}

      {error ? (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}

      {updated ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
          {t("toast.feedingRecorded")}
        </p>
      ) : null}

      {reported === "cat" ? (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
        >
          {/* Honest copy: "we'll review it", NOT "added" — a reported cat is
              new_unconfirmed until a caretaker confirms it. */}
          {t("toast.catReported")}
        </p>
      ) : reported ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
          {/* Honest copy: "flagged for caretakers", NOT "notified" —
              push/SMS isn't built yet. */}
          {reported === "urgent"
            ? t("toast.incidentReportedUrgent")
            : t("toast.incidentReported")}
        </p>
      ) : null}

      {confirmed === "cat" ? (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
        >
          {t("toast.catConfirmed")}
        </p>
      ) : null}

      {rejected === "cat" ? (
        <p
          role="status"
          className="rounded-lg bg-foreground/5 px-3 py-2 text-sm text-muted"
        >
          {t("toast.catRejected")}
        </p>
      ) : null}

      {photo === "failed" ? (
        <p
          role="status"
          className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
        >
          {t("toast.photoFailed")}
        </p>
      ) : null}

      <Link
        href={`/app/colonies/${id}/feed`}
        className={`${btnPrimary} min-h-14 text-base`}
      >
        {t("recordFeedingUpdate")}
      </Link>

      <Link
        href={`/app/colonies/${id}/incidents/new`}
        className={`${btnGhostDanger} -mt-3 inline-flex min-h-12 items-center justify-center gap-2 text-base`}
      >
        <WarningIcon className="h-5 w-5" aria-hidden />
        {t("reportIncident")}
      </Link>

      {/* Report a new cat — available to ALL roles (feeders included). The
          manager-only "Add cat" full form stays in the Cats section header. */}
      <Link
        href={`/app/colonies/${id}/cats/report`}
        className={`${btnGhost} -mt-3 inline-flex min-h-12 items-center justify-center gap-2 text-base`}
      >
        <PawIcon className="h-5 w-5" aria-hidden />
        {t("reportNewCat")}
      </Link>

      {/* Cats of concern — human-review queue. Caretakers see actionable rows
          (link to the cat's review block); feeders see the same context (the
          chip) but no actions, anywhere. Reason is icon + words, never colour
          alone. Empty state reassures rather than alarms. */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
            {t("catsOfConcern")}
          </h2>
          {activeConcern.length > 0 ? (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${toneClass.warn}`}
            >
              {activeConcern.length}
            </span>
          ) : null}
        </div>

        {concernCats.length === 0 ? (
          <p className={`${card} p-4 text-sm text-muted`}>
            {t("noCatsNeedReview")}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {activeConcern.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {activeConcern.map(({ cat: c, flag }) => (
                  <li key={c.id}>
                    <Link
                      href={`/app/colonies/${id}/cats/${c.id}`}
                      className={`${card} flex min-h-[56px] items-center gap-3 border-l-4 border-l-amber-400 px-4 py-3 transition hover:bg-foreground/5`}
                    >
                      <WarningIcon
                        className="h-5 w-5 shrink-0 text-amber-500"
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{catLabel(c)}</p>
                        <p className="text-xs text-muted">
                          {concernText(flag)}
                        </p>
                      </div>
                      <ChevronIcon className="h-4 w-4 shrink-0 text-muted" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}

            {monitoringConcern.length > 0 ? (
              <div className="flex flex-col gap-2">
                <h3 className="text-xs font-medium text-muted">
                  {t("monitoringCount", { count: monitoringConcern.length })}
                </h3>
                <ul className="flex flex-col gap-2">
                  {monitoringConcern.map(({ cat: c, flag }) => (
                    <li key={c.id}>
                      <Link
                        href={`/app/colonies/${id}/cats/${c.id}`}
                        className={`${card} flex min-h-[56px] items-center gap-3 px-4 py-3 transition hover:bg-foreground/5`}
                      >
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${toneClass.neutral}`}
                        >
                          {t("monitoring")}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{catLabel(c)}</p>
                          <p className="text-xs text-muted">
                            {concernText(flag)}
                          </p>
                        </div>
                        <ChevronIcon className="h-4 w-4 shrink-0 text-muted" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
            {t("catsHeading", { count: cats.length })}
          </h2>
          {canManage ? (
            <Link
              href={`/app/colonies/${id}/cats/new`}
              className={`${btnPrimary} text-sm`}
            >
              {t("addCat")}
            </Link>
          ) : null}
        </div>

        {cats.length === 0 ? (
          <EmptyState
            icon={<PawIcon className="h-7 w-7" />}
            title={t("catsEmptyTitle")}
            body={t("catsEmptyBody")}
            cta={
              canManage
                ? { href: `/app/colonies/${id}/cats/new`, label: t("addACat") }
                : undefined
            }
          />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {cats.map((c) => {
              const unconfirmed = c.status === UNCONFIRMED_STATUS;
              return (
                <li key={c.id}>
                  <Link
                    href={`/app/colonies/${id}/cats/${c.id}`}
                    className={`${card} flex min-h-[60px] items-center gap-3 px-4 py-3 transition hover:bg-foreground/5 ${
                      unconfirmed ? "border-l-4 border-l-accent" : ""
                    }`}
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-surface">
                      {photos.get(c.id) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={photos.get(c.id)!}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <PawIcon className="h-5 w-5 text-muted" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{catLabel(c)}</p>
                      <p className="flex items-center gap-1.5 text-xs text-muted">
                        {c.colour ? (
                          <span className="capitalize">{c.colour}</span>
                        ) : null}
                        {/* not colour alone: ★ glyph + words accompany the tone */}
                        <span
                          className={`rounded-full px-2 py-0.5 font-medium ${
                            unconfirmed ? "" : "capitalize"
                          } ${toneClass[statusTone(c.status)]}`}
                        >
                          {unconfirmed ? "★ " : ""}
                          {unconfirmed
                            ? tCat("status.newUnconfirmed")
                            : formatStatus(c.status)}
                        </span>
                      </p>
                    </div>
                    <ChevronIcon className="h-4 w-4 shrink-0 text-muted" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Recent feeding updates (read-only, all roles) ────────────────────
          Newest-first, ≤10, then a quiet "older not shown" line. Static rows
          (no detail page): fed/not-fed pill (icon+word, never colour-alone) +
          org-tz time + flag badges only when set + feeder email when it
          resolves + the note. Name-less rows are normal. */}
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          {t("recentFeedingHeading")}
        </h2>
        {feedingSection.rows.length === 0 ? (
          <EmptyState
            icon={<PawIcon className="h-7 w-7" />}
            title={t("noFeedingUpdatesTitle")}
            body={t("noFeedingUpdatesBody")}
          />
        ) : (
          <>
            <ol className="flex flex-col divide-y divide-border">
              {feedingSection.rows.map((row, i) => (
                <li
                  key={`${row.observedAt}-${i}`}
                  className="flex flex-col gap-1 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${toneClass[row.tone]}`}
                    >
                      {row.fed ? (
                        <PawIcon className="h-3.5 w-3.5" aria-hidden />
                      ) : (
                        <WarningIcon className="h-3.5 w-3.5" aria-hidden />
                      )}
                      {row.fed ? tFeed("outcomeFed") : tFeed("outcomeNotFed")}
                    </span>
                    {row.flags.map((flag) => (
                      <span
                        key={flag}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${toneClass.warn}`}
                      >
                        <WarningIcon className="h-3 w-3" aria-hidden />
                        {feedingFlagLabel[flag]}
                      </span>
                    ))}
                    <span className="ml-auto text-xs text-muted">
                      {dateTimeFmt.format(new Date(row.observedAt))}
                    </span>
                  </div>
                  {row.who ? (
                    <p className="text-xs text-muted [overflow-wrap:anywhere]">
                      {row.who}
                    </p>
                  ) : null}
                  {row.notes ? (
                    <p className="whitespace-pre-wrap text-sm">{row.notes}</p>
                  ) : null}
                </li>
              ))}
            </ol>
            {feedingSection.hasMore ? (
              <p className="text-xs text-muted">{t("olderUpdatesNotShown")}</p>
            ) : null}
          </>
        )}
      </section>

      {/* ── Recent incidents (read-only, all roles) ──────────────────────────
          ALL statuses now (resolved/closed included), newest-first, ≤10. Each
          row is a full-width link (≥44px) to the flat incident detail route;
          urgent open items get the red rail. Reporter attribution is silent. */}
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          {t("recentIncidentsHeading")}
        </h2>
        {incidentSection.rows.length === 0 ? (
          <EmptyState
            icon={<WarningIcon className="h-7 w-7" />}
            title={t("noIncidentsTitle")}
            body={t("noIncidentsBody")}
          />
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {incidentSection.rows.map((i) => {
                const urgent =
                  !!i.urgencyLevelId && urgentLevelIds.has(i.urgencyLevelId);
                return (
                  <li key={i.id}>
                    <Link
                      href={`/app/incidents/${i.id}`}
                      className={`${card} flex min-h-[56px] items-center gap-3 px-4 py-3 transition hover:bg-foreground/5 ${
                        urgent && i.status === "open"
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
                          {urgent ? <UrgentBadge /> : null}
                          <IncidentStatusPill status={i.status} />
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                          {i.catId && catNameById.get(i.catId) ? (
                            <span className="truncate">
                              {catNameById.get(i.catId)}
                            </span>
                          ) : null}
                          <span>
                            {dateTimeFmt.format(new Date(i.occurredAt))}
                          </span>
                        </p>
                      </div>
                      <ChevronIcon className="h-4 w-4 shrink-0 text-muted" />
                    </Link>
                  </li>
                );
              })}
            </ul>
            {incidentSection.hasMore ? (
              <p className="text-xs text-muted">{t("olderUpdatesNotShown")}</p>
            ) : null}
          </>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
            {t("scheduleHeading", { count: schedules.length })}
          </h2>
          {canManage ? (
            <Link
              href={`/app/colonies/${id}/schedules/new`}
              className={`${btnPrimary} text-sm`}
            >
              {t("addSchedule")}
            </Link>
          ) : null}
        </div>

        {schedules.length === 0 ? (
          <EmptyState
            icon={<CalendarIcon className="h-7 w-7" />}
            title={t("scheduleEmptyTitle")}
            body={t("scheduleEmptyBody")}
            cta={
              canManage
                ? {
                    href: `/app/colonies/${id}/schedules/new`,
                    label: t("addASchedule"),
                  }
                : undefined
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {schedules.map((s) => {
              const email = s.feeder_id
                ? (userEmails.get(s.feeder_id) ?? tc("unknown"))
                : tc("unassigned");
              const time = hhmm(s.approx_time);
              const isOneOff = !!s.specific_date;
              return (
                <li
                  key={s.id}
                  className={`${card} flex items-center gap-3 px-4 py-3`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{email}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <span className={pill}>
                        {isOneOff ? t("scheduleOneOff") : t("scheduleWeekly")}
                      </span>
                      <span>
                        {scheduleWhen({
                          weekday: s.weekday,
                          specific_date: s.specific_date,
                        })}
                      </span>
                      <span aria-hidden>·</span>
                      <span>{time ? `~${time}` : t("noTime")}</span>
                      {s.notes ? (
                        <span className="truncate">· {s.notes}</span>
                      ) : null}
                    </p>
                  </div>
                  {canManage ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <Link
                        href={`/app/colonies/${id}/schedules/${s.id}/edit`}
                        aria-label={t("editScheduleFor", { email })}
                        className={`${btnGhost} h-9 px-3 text-sm`}
                      >
                        {tc("edit")}
                      </Link>
                      <form action={deleteSchedule}>
                        <input type="hidden" name="colony_id" value={id} />
                        <input type="hidden" name="schedule_id" value={s.id} />
                        <ConfirmButton
                          confirm={t("removeScheduleConfirm")}
                          aria-label={t("deleteScheduleFor", { email })}
                          className={`${btnGhostDanger} h-9 px-3 text-sm`}
                        >
                          {tc("delete")}
                        </ConfirmButton>
                      </form>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
