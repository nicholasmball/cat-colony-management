import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/active-org";
import { photoSrc } from "@/lib/photo";
import { catLabel, formatStatus, statusTone } from "@/lib/cat-display";
import { scheduleWhen } from "@/lib/schedule";
import { createServiceClient } from "@/lib/supabase/service";
import { PawIcon, ChevronIcon, CalendarIcon } from "@/components/icons";
import { EmptyState } from "@/components/empty-state";
import { ConfirmButton } from "@/components/confirm-button";
import { deleteSchedule } from "./schedules/actions";
import { btnGhost, btnPrimary, card, pill } from "@/lib/ui";

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
  searchParams: Promise<{ updated?: string }>;
}) {
  const { id } = await params;
  const { updated } = await searchParams;
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
  const cats = (catsData ?? []) as Cat[];

  // Presigned thumbnail URL per cat (null → paw-icon fallback).
  const photos = new Map<string, string | null>(
    await Promise.all(
      cats.map(
        async (c) => [c.id, await photoSrc(c.photo_url)] as [string, string | null],
      ),
    ),
  );

  const canManage = org?.role === "admin" || org?.role === "caretaker";
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

  // Resolve feeder emails once for the distinct feeder ids (no per-row call).
  const feederEmails = new Map<string, string>();
  const feederIds = [
    ...new Set(schedules.map((s) => s.feeder_id).filter((v): v is string => !!v)),
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

      {updated ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
          ✓ Feeding update recorded.
        </p>
      ) : null}

      <Link
        href={`/app/colonies/${id}/feed`}
        className={`${btnPrimary} min-h-14 text-base`}
      >
        Record feeding update
      </Link>

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
            {cats.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/app/colonies/${id}/cats/${c.id}`}
                  className={`${card} flex min-h-[60px] items-center gap-3 px-4 py-3 transition hover:bg-foreground/5`}
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
                      <span
                        className={`rounded-full px-2 py-0.5 font-medium capitalize ${
                          toneClass[statusTone(c.status)]
                        }`}
                      >
                        {formatStatus(c.status)}
                      </span>
                    </p>
                  </div>
                  <ChevronIcon className="h-4 w-4 shrink-0 text-muted" />
                </Link>
              </li>
            ))}
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
                          className="h-9 rounded-lg border border-red-200 px-3 text-sm font-medium text-red-700 transition hover:bg-red-50 dark:border-red-900 dark:text-red-300"
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
