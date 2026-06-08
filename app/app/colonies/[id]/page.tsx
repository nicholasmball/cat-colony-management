import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/active-org";
import { photoSrc } from "@/lib/photo";
import { catLabel, formatStatus, statusTone } from "@/lib/cat-display";
import { UNCONFIRMED_STATUS, compareCatsForList } from "@/lib/cat-report";
import {
  concernCandidate,
  concernReasonText,
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
import { incidentTypeLabel } from "@/lib/incident";
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
  const org = await getActiveOrg();
  const supabase = await createClient();

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

  // Open incidents for this colony (all roles read). One query; urgency badged
  // from the org's alerts_immediately levels. Links to the flat detail route.
  const { data: openIncidentData } = await supabase
    .from("incidents")
    .select("id, type, status, cat_id, urgency_level_id, occurred_at")
    .eq("colony_id", id)
    .in("status", ["open", "in_progress"])
    .order("occurred_at", { ascending: false });
  const openIncidents = (openIncidentData ?? []) as {
    id: string;
    type: string;
    status: string;
    cat_id: string | null;
    urgency_level_id: string | null;
    occurred_at: string;
  }[];

  const urgentLevelIds = new Set<string>();
  if (openIncidents.length > 0 && org) {
    const { data: levelData } = await supabase
      .from("incident_urgency_levels")
      .select("id, alerts_immediately")
      .eq("organisation_id", org.organisation_id);
    for (const l of levelData ?? []) {
      if (l.alerts_immediately) urgentLevelIds.add(l.id as string);
    }
  }
  const catNameById = new Map(cats.map((c) => [c.id, catLabel(c)]));

  // Resolve feeder emails once for the distinct feeder ids (no per-row call).
  const feederEmails = new Map<string, string>();
  const feederIds = [
    ...new Set(
      schedules.map((s) => s.feeder_id).filter((v): v is string => !!v),
    ),
  ];
  if (feederIds.length > 0) {
    const svc = createServiceClient();
    await Promise.all(
      feederIds.map(async (uid) => {
        const { data } = await svc.auth.admin.getUserById(uid);
        feederEmails.set(uid, data.user?.email ?? "unknown");
      }),
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6 px-6 py-6 md:px-10">
      <Link href="/app/colonies" className="text-sm text-accent">
        ← Colonies
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">{colony.name}</h1>
          <p className="text-sm text-muted">
            {start
              ? `Feeds ${start}${end ? `–${end}` : ""}`
              : "No feeding window set"}
            {!colony.is_active ? " · inactive" : ""}
          </p>
        </div>
        {canManage ? (
          <Link
            href={`/app/colonies/${id}/edit`}
            className={`${btnGhost} text-sm`}
          >
            Edit
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
          ✓ Feeding update recorded.
        </p>
      ) : null}

      {reported === "cat" ? (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
        >
          {/* Honest copy: "we'll review it", NOT "added" — a reported cat is
              new_unconfirmed until a caretaker confirms it. */}
          ✓ Cat reported. A caretaker will review it.
        </p>
      ) : reported ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
          {/* Honest copy: "flagged for caretakers", NOT "notified" —
              push/SMS isn't built yet. */}
          ✓ Incident reported.
          {reported === "urgent" ? " Flagged as urgent for caretakers." : ""}
        </p>
      ) : null}

      {confirmed === "cat" ? (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
        >
          ✓ Cat confirmed and added to the colony.
        </p>
      ) : null}

      {rejected === "cat" ? (
        <p
          role="status"
          className="rounded-lg bg-foreground/5 px-3 py-2 text-sm text-muted"
        >
          Reported cat rejected and removed from the colony.
        </p>
      ) : null}

      {photo === "failed" ? (
        <p
          role="status"
          className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
        >
          The photo didn’t attach, but your report was saved.
        </p>
      ) : null}

      <Link
        href={`/app/colonies/${id}/feed`}
        className={`${btnPrimary} min-h-14 text-base`}
      >
        Record feeding update
      </Link>

      <Link
        href={`/app/colonies/${id}/incidents/new`}
        className={`${btnGhostDanger} -mt-3 inline-flex min-h-12 items-center justify-center gap-2 text-base`}
      >
        <WarningIcon className="h-5 w-5" aria-hidden />
        Report an incident
      </Link>

      {/* Report a new cat — available to ALL roles (feeders included). The
          manager-only "Add cat" full form stays in the Cats section header. */}
      <Link
        href={`/app/colonies/${id}/cats/report`}
        className={`${btnGhost} -mt-3 inline-flex min-h-12 items-center justify-center gap-2 text-base`}
      >
        <PawIcon className="h-5 w-5" aria-hidden />
        Report a new cat
      </Link>

      {/* Cats of concern — human-review queue. Caretakers see actionable rows
          (link to the cat's review block); feeders see the same context (the
          chip) but no actions, anywhere. Reason is icon + words, never colour
          alone. Empty state reassures rather than alarms. */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Cats of concern
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
            No cats need review.
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
                          {concernReasonText(flag)}
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
                  Monitoring ({monitoringConcern.length})
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
                          Monitoring
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{catLabel(c)}</p>
                          <p className="text-xs text-muted">
                            {concernReasonText(flag)}
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
            Cats ({cats.length})
          </h2>
          {canManage ? (
            <Link
              href={`/app/colonies/${id}/cats/new`}
              className={`${btnPrimary} text-sm`}
            >
              Add cat
            </Link>
          ) : null}
        </div>

        {cats.length === 0 ? (
          <EmptyState
            icon={<PawIcon className="h-7 w-7" />}
            title="No cats recorded"
            body="Add the cats you see here so feeders can mark them each visit."
            cta={
              canManage
                ? { href: `/app/colonies/${id}/cats/new`, label: "Add a cat" }
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
                          {formatStatus(c.status)}
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

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Incidents ({openIncidents.length})
        </h2>
        {openIncidents.length === 0 ? (
          <p className={`${card} p-4 text-sm text-muted`}>
            No open incidents for this colony.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {openIncidents.map((i) => {
              const urgent =
                !!i.urgency_level_id && urgentLevelIds.has(i.urgency_level_id);
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
                        <span className="truncate">
                          {incidentTypeLabel(i.type)}
                        </span>
                        {urgent ? <UrgentBadge /> : null}
                        <IncidentStatusPill status={i.status} />
                      </p>
                      {i.cat_id && catNameById.get(i.cat_id) ? (
                        <p className="mt-0.5 truncate text-xs text-muted">
                          {catNameById.get(i.cat_id)}
                        </p>
                      ) : null}
                    </div>
                    <ChevronIcon className="h-4 w-4 shrink-0 text-muted" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Feeding schedule ({schedules.length})
          </h2>
          {canManage ? (
            <Link
              href={`/app/colonies/${id}/schedules/new`}
              className={`${btnPrimary} text-sm`}
            >
              Add schedule
            </Link>
          ) : null}
        </div>

        {schedules.length === 0 ? (
          <EmptyState
            icon={<CalendarIcon className="h-7 w-7" />}
            title="No schedule yet"
            body="Assign feeders to this colony so it shows up on their Today list."
            cta={
              canManage
                ? {
                    href: `/app/colonies/${id}/schedules/new`,
                    label: "Add a schedule",
                  }
                : undefined
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {schedules.map((s) => {
              const email = s.feeder_id
                ? (feederEmails.get(s.feeder_id) ?? "unknown")
                : "Unassigned";
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
                        {isOneOff ? "★ one-off" : "⟳ weekly"}
                      </span>
                      <span>
                        {scheduleWhen({
                          weekday: s.weekday,
                          specific_date: s.specific_date,
                        })}
                      </span>
                      <span aria-hidden>·</span>
                      <span>{time ? `~${time}` : "no time"}</span>
                      {s.notes ? (
                        <span className="truncate">· {s.notes}</span>
                      ) : null}
                    </p>
                  </div>
                  {canManage ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <Link
                        href={`/app/colonies/${id}/schedules/${s.id}/edit`}
                        aria-label={`Edit schedule for ${email}`}
                        className={`${btnGhost} h-9 px-3 text-sm`}
                      >
                        Edit
                      </Link>
                      <form action={deleteSchedule}>
                        <input type="hidden" name="colony_id" value={id} />
                        <input type="hidden" name="schedule_id" value={s.id} />
                        <ConfirmButton
                          confirm="Remove this schedule?"
                          aria-label={`Delete schedule for ${email}`}
                          className={`${btnGhostDanger} h-9 px-3 text-sm`}
                        >
                          Delete
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
