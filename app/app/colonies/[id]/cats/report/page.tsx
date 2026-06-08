import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/active-org";
import { CatReportForm } from "@/components/cat-report-form";

const errorClass =
  "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300";

// Report a new cat — available to ALL roles on the colony (feeders included).
// Distinct from the manager-only "Add cat" full form: this is the quick,
// non-blocking field report that lands as new_unconfirmed for caretaker review.
export default async function ReportCatPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const org = await getActiveOrg();
  if (!org) redirect("/app");

  const supabase = await createClient();
  const { data: colony } = await supabase
    .from("colonies")
    .select("id, name")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!colony) notFound();

  return (
    <div className="flex max-w-xl flex-col gap-5 px-6 py-6 md:px-10">
      <Link href={`/app/colonies/${id}`} className="text-sm text-accent">
        ← {colony.name}
      </Link>
      <h1 className="font-display text-3xl">Report a new cat</h1>
      {error ? (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}
      <CatReportForm colonyId={id} />
    </div>
  );
}
