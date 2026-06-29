import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/active-org";
import { photoSrc } from "@/lib/photo";
import { FeedForm } from "@/components/feed-form";

const errorClass =
  "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300";

export default async function FeedPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const t = await getTranslations("feed");
  const org = await getActiveOrg();
  const supabase = await createClient();

  const { data: colony } = await supabase
    .from("colonies")
    .select("id, name")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!colony) notFound();

  const { data: catsData } = await supabase
    .from("cats")
    .select("id, name, temp_id, photo_url")
    .eq("colony_id", id)
    .is("deleted_at", null)
    .order("name", { nullsFirst: false });
  const catRows = catsData ?? [];

  // Presigned thumbnail URL per cat (null → paw-icon fallback). One bounded
  // Promise.all (no N+1), mirroring colonies/[id] detail; a missing/active-less
  // org degrades to "" → photoSrc returns null → paw, never throws.
  const orgId = org?.organisation_id ?? "";
  const photos = new Map<string, string | null>(
    await Promise.all(
      catRows.map(
        async (c) =>
          [c.id, await photoSrc(c.photo_url, orgId)] as [string, string | null],
      ),
    ),
  );
  const cats = catRows.map((c) => ({
    id: c.id,
    name: c.name,
    temp_id: c.temp_id,
    photoSrc: photos.get(c.id) ?? null,
  }));

  return (
    <div className="flex max-w-xl flex-col gap-5 px-6 py-6 md:px-10">
      <Link href={`/app/colonies/${id}`} className="text-sm text-accent">
        ← {colony.name}
      </Link>
      <h1 className="font-display text-3xl">{t("title")}</h1>
      {error ? (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}
      <FeedForm
        colonyId={id}
        cats={cats}
        timezone={org?.timezone ?? "Europe/Lisbon"}
      />
    </div>
  );
}
