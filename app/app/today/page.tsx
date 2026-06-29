import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/active-org";
import { dayRangeInTz, todayInTz } from "@/lib/time";
import { localWeekday } from "@/lib/schedule";
import { type FeedingStatus } from "@/lib/feeding-status";
import {
  colonyWindowStatuses,
  overallWindowStatus,
  windowRangeLabel,
  type WindowStatus,
} from "@/lib/feeding-windows";
import { getWindowsByColony } from "../colonies/feeding-windows";
import { DEFAULT_FEEDING_MISSED_HOURS } from "@/lib/alert-settings";
import { CalendarIcon, ChevronIcon, PawIcon } from "@/components/icons";
import { EmptyState } from "@/components/empty-state";
import { card } from "@/lib/ui";

type ColonyRow = {
  id: string;
  name: string;
};

type TodayRow = {
  id: string;
  name: string;
  // Per feeding window (empty when the colony has no windows configured).
  windows: WindowStatus[];
  // Worst window status (or "pending" when there are no windows) — drives
  // bucketing, the sort and the red rail.
  status: FeedingStatus;
  // Earliest window start, for the within-bucket sort (null = no window).
  earliestStart: string | null;
  // Manager-only: is anyone scheduled to feed this colony today? null for feeders.
  assignedToday: boolean | null;
};

const pillTone: Record<FeedingStatus, string> = {
  fed: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  pending: "bg-foreground/5 text-muted",
  missed: "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300",
};

// Status glyph: icon + word, never colour alone (WCAG 1.4.1). aria-hidden so the
// adjacent word carries the meaning for assistive tech.
function StatusGlyph({ status }: { status: FeedingStatus }) {
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

const statusRank: Record<FeedingStatus, number> = {
  missed: 0,
  pending: 1,
  fed: 2,
};

export default async function TodayPage() {
  const org = await getActiveOrg();
  if (!org) redirect("/app");

  const t = await getTranslations("today");
  const locale = await getLocale();
  const supabase = await createClient();
  const dayRange = dayRangeInTz(org.timezone);
  const todayLocal = todayInTz(org.timezone);
  const weekdayLocal = localWeekday(todayLocal);
  const isManager = org.role === "admin" || org.role === "caretaker";

  // Schedules matching today (active, non-deleted, one-off today OR weekly
  // today). Feeders: only their own rows; managers: the whole org. One query
  // either way — no per-colony/per-schedule calls.
  let schedulesQuery = supabase
    .from("feeding_schedules")
    .select("colony_id, feeder_id")
    .eq("organisation_id", org.organisation_id)
    .eq("is_active", true)
    .is("deleted_at", null)
    .or(`specific_date.eq.${todayLocal},weekday.eq.${weekdayLocal}`);

  if (!isManager) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    schedulesQuery = schedulesQuery.eq("feeder_id", user?.id ?? "");
  }

  const { data: scheduleRows } = await schedulesQuery;
  // colony_ids assigned today (managers: any feeder; feeders: themselves).
  const assignedColonyIds = new Set(
    (scheduleRows ?? []).map((s) => s.colony_id as string),
  );

  // Manager → all active colonies (existing behaviour). Feeder → only the
  // colonies they're scheduled for today; if none, skip the colonies query.
  let coloniesQuery = supabase
    .from("colonies")
    .select("id, name")
    .eq("organisation_id", org.organisation_id)
    .eq("is_active", true)
    .is("deleted_at", null);
  if (!isManager) {
    coloniesQuery = coloniesQuery.in("id", [...assignedColonyIds]);
  }

  // Both reads org-scoped (RLS also enforces it). No per-colony loop: a single
  // feeding_events query for the whole day powers every row's status. The org's
  // alert_settings row supplies the editable feeding-missed threshold.
  const [coloniesResult, feedsResult, settingsResult] = await Promise.all([
    isManager || assignedColonyIds.size > 0
      ? coloniesQuery
      : Promise.resolve({ data: [] as ColonyRow[] }),
    supabase
      .from("feeding_events")
      .select("colony_id, observed_at, fed")
      .eq("organisation_id", org.organisation_id)
      .gte("observed_at", dayRange.startUtc.toISOString())
      .lt("observed_at", dayRange.endUtc.toISOString()),
    supabase
      .from("alert_settings")
      .select("feeding_missed_hours")
      .eq("organisation_id", org.organisation_id)
      .maybeSingle(),
  ]);

  const colonies = (coloniesResult.data ?? []) as ColonyRow[];
  // Effective feeding-missed threshold in minutes: the org row, else the default.
  const missedAfterMin =
    (settingsResult.data?.feeding_missed_hours ??
      DEFAULT_FEEDING_MISSED_HOURS) * 60;

  // Per-window status. One batched windows read, and today's events grouped by
  // colony in memory — no per-colony query. Each window gets its own fed/missed
  // line; a colony with no windows keeps the legacy single "No window" row.
  const now = new Date();
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

  const rows: TodayRow[] = colonies.map((c) => {
    const windows = colonyWindowStatuses(
      windowsByColony.get(c.id) ?? [],
      feedsByColony.get(c.id) ?? [],
      org.timezone,
      now,
      missedAfterMin,
    );
    // No windows → a single pending "No window" row (legacy behaviour preserved).
    const status =
      windows.length > 0
        ? overallWindowStatus(windows.map((w) => w.status))
        : "pending";
    const earliestStart = windows.find((w) => w.start != null)?.start ?? null;
    return {
      id: c.id,
      name: c.name,
      windows,
      status,
      earliestStart,
      // Coverage gap marker is manager-only; feeders already see only their own.
      assignedToday: isManager ? assignedColonyIds.has(c.id) : null,
    };
  });

  // Actionable first: missed, then pending (by window start ascending, no-window
  // last within the group), then fed at the bottom.
  rows.sort((a, b) => {
    if (statusRank[a.status] !== statusRank[b.status]) {
      return statusRank[a.status] - statusRank[b.status];
    }
    const as = a.earliestStart;
    const bs = b.earliestStart;
    if (as === bs) return 0;
    if (as == null) return 1;
    if (bs == null) return -1;
    return as < bs ? -1 : 1;
  });

  const needsFeeding = rows.filter((r) => r.status !== "fed");
  const done = rows.filter((r) => r.status === "fed");

  // Display dates use the active UI locale (pt-PT / en-GB) so weekday + month
  // names and ordering match the chosen language; the org timezone is preserved.
  const displayLocale = locale === "pt" ? "pt-PT" : "en-GB";
  const dateLabel = new Intl.DateTimeFormat(displayLocale, {
    timeZone: org.timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  const timeFmt = new Intl.DateTimeFormat(displayLocale, {
    timeZone: org.timezone,
    hour: "2-digit",
    minute: "2-digit",
  });

  function StatusPill({ status }: { status: FeedingStatus }) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${pillTone[status]}`}
      >
        <StatusGlyph status={status} />
        {t(`status.${status}`)}
      </span>
    );
  }

  function Row({ row }: { row: TodayRow }) {
    const href =
      row.status === "fed"
        ? `/app/colonies/${row.id}`
        : `/app/colonies/${row.id}/feed`;
    return (
      <li>
        <Link
          href={href}
          className={`${card} flex min-h-[60px] items-start gap-3 px-4 py-3 transition hover:bg-foreground/5 ${
            row.status === "missed" ? "border-l-4 border-l-red-500" : ""
          }`}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{row.name}</p>
            {row.windows.length > 0 ? (
              // One status line per feeding window (morning ✓ Fed · evening ⚠ Missed).
              <span className="mt-1 flex flex-col gap-1">
                {row.windows.map((w) => (
                  <span
                    key={w.windowKey}
                    className="flex flex-wrap items-center gap-1.5 text-xs text-muted"
                  >
                    <span className="font-medium tabular-nums text-foreground">
                      {windowRangeLabel(w.start, w.end)}
                    </span>
                    <StatusPill status={w.status} />
                    {w.status === "fed" && w.fedAt ? (
                      <span>{timeFmt.format(new Date(w.fedAt))}</span>
                    ) : null}
                  </span>
                ))}
                {row.assignedToday === false ? (
                  <span className="inline-flex w-fit items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                    <CalendarIcon className="h-3 w-3" aria-hidden />
                    {t("noOneAssignedToday")}
                  </span>
                ) : null}
              </span>
            ) : (
              // No windows configured → the legacy single "No window" line.
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                <span>{t("noWindow")}</span>
                <span aria-hidden>·</span>
                <StatusPill status={row.status} />
                {row.assignedToday === false ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                    <CalendarIcon className="h-3 w-3" aria-hidden />
                    {t("noOneAssignedToday")}
                  </span>
                ) : null}
              </p>
            )}
          </div>
          <span className="shrink-0 text-sm font-semibold text-accent">
            {row.status === "fed" ? (
              <span className="text-muted">{t("viewArrow")}</span>
            ) : (
              t("feedArrow")
            )}
          </span>
          <ChevronIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
        </Link>
      </li>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6 px-6 py-6 md:px-10">
      <div>
        <h1 className="font-display text-3xl">{t("title")}</h1>
        <p className="text-sm text-muted">{dateLabel}</p>
      </div>

      {rows.length === 0 ? (
        isManager ? (
          <EmptyState
            icon={<PawIcon className="h-7 w-7" />}
            title={t("emptyManagerTitle")}
            body={t("emptyManagerBody")}
          />
        ) : (
          <EmptyState
            icon={<CalendarIcon className="h-7 w-7" />}
            title={t("emptyFeederTitle")}
            body={t("emptyFeederBody")}
          />
        )
      ) : (
        <div className="flex flex-col gap-6">
          {needsFeeding.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                {t("needsFeeding")}
              </h2>
              <ul className="flex flex-col gap-2">
                {needsFeeding.map((r) => (
                  <Row key={r.id} row={r} />
                ))}
              </ul>
            </section>
          ) : null}

          {done.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                {t("doneToday")}
              </h2>
              <ul className="flex flex-col gap-2">
                {done.map((r) => (
                  <Row key={r.id} row={r} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
