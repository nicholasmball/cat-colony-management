import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/active-org";
import { dayRangeInTz, minutesAfterWindow } from "@/lib/time";
import { feedingStatus, type FeedingStatus } from "@/lib/feeding-status";
import { ChevronIcon, PawIcon } from "@/components/icons";
import { EmptyState } from "@/components/empty-state";
import { card } from "@/lib/ui";

type ColonyRow = {
  id: string;
  name: string;
  feeding_window_start: string | null;
  feeding_window_end: string | null;
};

type TodayRow = {
  id: string;
  name: string;
  windowStart: string | null;
  windowEnd: string | null;
  status: FeedingStatus;
  fedAt: Date | null;
};

const pillTone: Record<FeedingStatus, string> = {
  fed: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  pending: "bg-foreground/5 text-muted",
  missed: "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300",
};

const pillLabel: Record<FeedingStatus, string> = {
  fed: "fed",
  pending: "pending",
  missed: "missed",
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
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-2.5 w-2.5">
      <circle cx="12" cy="12" r="6" />
    </svg>
  );
}

function hhmm(t: string | null) {
  return t ? t.slice(0, 5) : null;
}

// "08–09" from window start/end, or "No window" when no schedule is set.
function windowText(start: string | null, end: string | null) {
  const s = hhmm(start);
  const e = hhmm(end);
  if (!s && !e) return "No window";
  return `${s ?? "—"}–${e ?? "—"}`;
}

const statusRank: Record<FeedingStatus, number> = {
  missed: 0,
  pending: 1,
  fed: 2,
};

export default async function TodayPage() {
  const org = await getActiveOrg();
  if (!org) redirect("/app");

  const supabase = await createClient();
  const dayRange = dayRangeInTz(org.timezone);

  // Two reads, both org-scoped (RLS also enforces it). No per-colony loop: a
  // single feeding_events query for the whole day powers every row's status.
  const [coloniesResult, feedsResult] = await Promise.all([
    supabase
      .from("colonies")
      .select("id, name, feeding_window_start, feeding_window_end")
      .eq("organisation_id", org.organisation_id)
      .eq("is_active", true)
      .is("deleted_at", null),
    supabase
      .from("feeding_events")
      .select("colony_id, observed_at")
      .eq("organisation_id", org.organisation_id)
      .eq("fed", true)
      .gte("observed_at", dayRange.startUtc.toISOString())
      .lt("observed_at", dayRange.endUtc.toISOString()),
  ]);

  const colonies = (coloniesResult.data ?? []) as ColonyRow[];

  // colony_id → latest fed time today, by observed_at (field-observation time,
  // not insert time — correct for offline backfill and uses the observed_at
  // index). Keeping the latest so the row shows the most recent feed.
  const fedAt = new Map<string, Date>();
  for (const f of feedsResult.data ?? []) {
    const at = new Date(f.observed_at as string);
    const prev = fedAt.get(f.colony_id as string);
    if (!prev || at > prev) fedAt.set(f.colony_id as string, at);
  }

  const rows: TodayRow[] = colonies.map((c) => {
    const fed = fedAt.has(c.id);
    const minutesAfterClose = c.feeding_window_end
      ? minutesAfterWindow(c.feeding_window_end, org.timezone)
      : null;
    return {
      id: c.id,
      name: c.name,
      windowStart: c.feeding_window_start,
      windowEnd: c.feeding_window_end,
      status: feedingStatus({ fed, minutesAfterClose }),
      fedAt: fedAt.get(c.id) ?? null,
    };
  });

  // Actionable first: missed, then pending (by window start ascending, no-window
  // last within the group), then fed at the bottom.
  rows.sort((a, b) => {
    if (statusRank[a.status] !== statusRank[b.status]) {
      return statusRank[a.status] - statusRank[b.status];
    }
    const as = a.windowStart;
    const bs = b.windowStart;
    if (as === bs) return 0;
    if (as == null) return 1;
    if (bs == null) return -1;
    return as < bs ? -1 : 1;
  });

  const needsFeeding = rows.filter((r) => r.status !== "fed");
  const done = rows.filter((r) => r.status === "fed");

  const dateLabel = new Intl.DateTimeFormat(undefined, {
    timeZone: org.timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  const timeFmt = new Intl.DateTimeFormat(undefined, {
    timeZone: org.timezone,
    hour: "2-digit",
    minute: "2-digit",
  });

  function Row({ row }: { row: TodayRow }) {
    const href =
      row.status === "fed"
        ? `/app/colonies/${row.id}`
        : `/app/colonies/${row.id}/feed`;
    return (
      <li>
        <Link
          href={href}
          className={`${card} flex min-h-[60px] items-center gap-3 px-4 py-3 transition hover:bg-foreground/5`}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{row.name}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
              <span>{windowText(row.windowStart, row.windowEnd)}</span>
              <span aria-hidden>·</span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
                  pillTone[row.status]
                }`}
              >
                <StatusGlyph status={row.status} />
                {pillLabel[row.status]}
              </span>
              {row.status === "fed" && row.fedAt ? (
                <span>{timeFmt.format(row.fedAt)}</span>
              ) : null}
            </p>
          </div>
          <span className="shrink-0 text-sm font-semibold text-accent">
            {row.status === "fed" ? (
              <span className="text-muted">View →</span>
            ) : (
              "Feed →"
            )}
          </span>
          <ChevronIcon className="h-4 w-4 shrink-0 text-muted" />
        </Link>
      </li>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6 px-6 py-6 md:px-10">
      <div>
        <h1 className="font-display text-3xl">Today</h1>
        <p className="text-sm text-muted">{dateLabel}</p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<PawIcon className="h-7 w-7" />}
          title="No colonies to feed yet"
          body="When a colony is added to this organisation, it'll show up here for the day."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {needsFeeding.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                Needs feeding
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
                Done today
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
