import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/active-org";
import { SubmitButton } from "@/components/submit-button";
import { btnPrimary, card, fieldLabel, input } from "@/lib/ui";
import { updateOrganisation } from "./actions";

const errorClass =
  "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300";
const okClass =
  "rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300";

export default async function OrgSettings({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const org = await getActiveOrg();
  if (!org) redirect("/app");
  if (org.role !== "admin") redirect("/app"); // admin-only screen

  const { error, saved } = await searchParams;

  const supabase = await createClient();
  const { data } = await supabase
    .from("organisations")
    .select("name, notes, created_at")
    .eq("id", org.organisation_id)
    .maybeSingle();

  const created = data?.created_at
    ? new Date(data.created_at).toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <div className="flex max-w-xl flex-col gap-5 px-6 py-6 md:px-10">
      <div>
        <h1 className="font-display text-3xl">Organisation</h1>
        {created ? (
          <p className="text-sm text-muted">Created {created}</p>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}
      {saved ? <p className={okClass}>✓ Saved.</p> : null}

      <form action={updateOrganisation} className={`${card} flex flex-col gap-4 p-4`}>
        <label className={fieldLabel}>
          <span>Name</span>
          <input
            name="name"
            required
            defaultValue={data?.name ?? ""}
            className={input}
          />
        </label>
        <label className={fieldLabel}>
          <span>Notes</span>
          <textarea
            name="notes"
            rows={4}
            defaultValue={data?.notes ?? ""}
            placeholder="e.g. Registered charity no., main contact, anything the team should know."
            className={`${input} py-2`}
          />
        </label>
        <SubmitButton pendingText="Saving…" className={`${btnPrimary} self-start`}>
          Save changes
        </SubmitButton>
      </form>
    </div>
  );
}
