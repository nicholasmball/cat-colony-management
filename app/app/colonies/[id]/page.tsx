import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/active-org";
import { photoSrc } from "@/lib/photo";
import { catLabel, formatStatus, statusTone } from "@/lib/cat-display";
import { PawIcon, ChevronIcon } from "@/components/icons";
import { btnGhost, btnPrimary, card } from "@/lib/ui";

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
          <p className={`${card} p-6 text-center text-sm text-muted`}>
            No cats recorded yet.{canManage ? " Add your first one above." : ""}
          </p>
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
    </div>
  );
}
