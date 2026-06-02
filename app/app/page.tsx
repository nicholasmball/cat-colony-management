import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createOrganisation } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { btnPrimary, card, input, pill } from "@/lib/ui";

type MembershipRow = {
  role: string;
  organisation_id: string;
  organisations: { name: string } | null;
};

export default async function AppHome({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS scopes this to the caller's own memberships + organisations.
  const { data } = await supabase
    .from("memberships")
    .select("role, organisation_id, organisations(name)")
    .is("deleted_at", null);
  const memberships = (data ?? []) as unknown as MembershipRow[];

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 p-6">
      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <h1 className="font-display text-2xl">Your organisations</h1>
        {memberships.length === 0 ? (
          <p className={`${card} p-4 text-sm text-muted`}>
            You&rsquo;re not part of an organisation yet — create one below to
            get started.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {memberships.map((m) => (
              <li
                key={m.organisation_id}
                className={`${card} flex items-center justify-between px-4 py-3`}
              >
                <span className="font-medium">
                  {m.organisations?.name ?? "Organisation"}
                </span>
                <span className={pill}>{m.role}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2 border-t border-border pt-5">
        <h2 className="text-sm font-medium text-muted">
          Create an organisation
        </h2>
        <form action={createOrganisation} className="flex gap-2">
          <input
            name="name"
            required
            placeholder="Organisation name"
            className={`${input} flex-1`}
          />
          <SubmitButton pendingText="Creating…" className={btnPrimary}>
            Create
          </SubmitButton>
        </form>
        <p className="text-xs text-muted">
          You&rsquo;ll become its administrator.
        </p>
      </section>
    </div>
  );
}
