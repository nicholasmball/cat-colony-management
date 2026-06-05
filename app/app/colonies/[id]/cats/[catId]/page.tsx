import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/active-org";
import { photoSrc } from "@/lib/photo";
import { catLabel, formatStatus, statusTone } from "@/lib/cat-display";
import { PawIcon } from "@/components/icons";
import { btnGhost, card } from "@/lib/ui";

const toneClass: Record<string, string> = {
  good: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  warn: "bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  bad: "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300",
  neutral: "bg-foreground/5 text-muted",
};

// Render a labelled fact only when it has a value — records accept incomplete
// data, so we never show empty rows or "unknown".
function Fact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className={`${card} p-3`}>
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}

export default async function CatDetail({
  params,
}: {
  params: Promise<{ id: string; catId: string }>;
}) {
  const { id, catId } = await params;
  const org = await getActiveOrg();
  const supabase = await createClient();

  const { data: cat } = await supabase
    .from("cats")
    .select(
      "id, name, temp_id, colour, markings, sex, neutered, approx_age, status, notes, photo_url",
    )
    .eq("id", catId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!cat) notFound();

  // Breadcrumb back to the colony by name (falls back to a generic label).
  const { data: colony } = await supabase
    .from("colonies")
    .select("name")
    .eq("id", id)
    .maybeSingle();

  const photo = await photoSrc(cat.photo_url as string | null);
  const canManage = org?.role === "admin" || org?.role === "caretaker";
  const label = catLabel(cat);
  const sex =
    cat.sex && cat.neutered != null
      ? `${cat.sex} · ${cat.neutered ? "neutered" : "not neutered"}`
      : cat.sex
        ? cat.sex
        : cat.neutered != null
          ? cat.neutered
            ? "neutered"
            : "not neutered"
          : null;

  return (
    <div className="flex max-w-3xl flex-col gap-6 px-6 py-6 md:px-10">
      <Link href={`/app/colonies/${id}`} className="text-sm text-accent">
        ← {colony?.name ?? "Colony"}
      </Link>

      <div className="grid gap-6 md:grid-cols-[260px_1fr] md:items-start">
        {/* Photo (or paw fallback) */}
        <div className="grid aspect-square w-full max-w-[260px] place-items-center overflow-hidden rounded-2xl border border-border bg-surface">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photo}
              alt={`Photo of ${label}`}
              className="h-full w-full object-cover"
            />
          ) : (
            <PawIcon className="h-16 w-16 text-muted" />
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-3xl">{label}</h1>
              <span
                className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
                  toneClass[statusTone(cat.status)]
                }`}
              >
                {formatStatus(cat.status)}
              </span>
            </div>
            {canManage ? (
              <Link
                href={`/app/colonies/${id}/cats/${catId}/edit`}
                className={`${btnGhost} text-sm`}
              >
                Edit
              </Link>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Fact label="Colour" value={cat.colour} />
            <Fact label="Markings" value={cat.markings} />
            <Fact label="Sex" value={sex} />
            <Fact label="Approx. age" value={cat.approx_age} />
          </div>
          {cat.notes ? (
            <div className={`${card} p-3`}>
              <p className="text-xs uppercase tracking-wide text-muted">Notes</p>
              <p className="whitespace-pre-wrap text-sm">{cat.notes}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
