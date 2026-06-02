import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
  const supabase = await createClient();

  const { data: colony } = await supabase
    .from("colonies")
    .select("id, name")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!colony) notFound();

  const { data: cats } = await supabase
    .from("cats")
    .select("id, name, temp_id")
    .eq("colony_id", id)
    .is("deleted_at", null)
    .order("name", { nullsFirst: false });

  return (
    <div className="flex max-w-xl flex-col gap-5 px-6 py-6 md:px-10">
      <Link href={`/app/colonies/${id}`} className="text-sm text-accent">
        ← {colony.name}
      </Link>
      <h1 className="font-display text-3xl">Feeding update</h1>
      {error ? (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}
      <FeedForm colonyId={id} cats={cats ?? []} />
    </div>
  );
}
