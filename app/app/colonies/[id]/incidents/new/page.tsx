import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/active-org";
import { defaultUrgencyLevel, type UrgencyLevel } from "@/lib/incident";
import { IncidentForm } from "@/components/incident-form";

const errorClass =
  "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300";

export default async function NewIncidentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const t = await getTranslations("colonies");
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

  const { data: cats } = await supabase
    .from("cats")
    .select("id, name, temp_id")
    .eq("colony_id", id)
    .is("deleted_at", null)
    .order("name", { nullsFirst: false });

  // The org's urgency lookup — feeds the segmented control and the default
  // selection (the org's not-urgent baseline). RLS scopes this read.
  const { data: levelsData } = await supabase
    .from("incident_urgency_levels")
    .select("id, key, label, sort_order, alerts_immediately")
    .eq("organisation_id", org.organisation_id)
    .order("sort_order", { ascending: true });
  const levels = (levelsData ?? []) as UrgencyLevel[];
  const defaultLevel = defaultUrgencyLevel(levels);

  return (
    <div className="flex max-w-xl flex-col gap-5 px-6 py-6 md:px-10">
      <Link href={`/app/colonies/${id}`} className="text-sm text-accent">
        ← {colony.name}
      </Link>
      <h1 className="font-display text-3xl">{t("reportIncident")}</h1>
      {error ? (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}
      <IncidentForm
        colonyId={id}
        cats={cats ?? []}
        urgencyLevels={levels.map((l) => ({
          id: l.id,
          label: l.label,
          alerts_immediately: l.alerts_immediately,
        }))}
        defaultUrgencyId={defaultLevel?.id ?? null}
      />
    </div>
  );
}
