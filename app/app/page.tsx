import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createOrganisation } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { PawIcon, ChevronIcon } from "@/components/icons";
import { btnPrimary, card, input } from "@/lib/ui";

type MembershipRow = {
  role: string;
  organisation_id: string;
  organisations: { name: string } | null;
};

const errorClass =
  "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300";

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

  const { data } = await supabase
    .from("memberships")
    .select("role, organisation_id, organisations(name)")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  const memberships = (data ?? []) as unknown as MembershipRow[];

  // ── First-run: no organisation yet → onboarding ───────────────────────────
  if (memberships.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-5 p-6">
        {error ? (
          <p role="alert" className={errorClass}>
            {error}
          </p>
        ) : null}
        <div className="space-y-1">
          <h1 className="font-display text-3xl">Welcome</h1>
          <p className="text-sm text-muted">
            Let&rsquo;s set up your organisation to get started.
          </p>
        </div>
        <form
          action={createOrganisation}
          className={`${card} flex flex-col gap-3 p-5`}
        >
          <label className="text-sm font-medium" htmlFor="org-name">
            Organisation name
          </label>
          <input
            id="org-name"
            name="name"
            required
            placeholder="e.g. Street Cats of Tavira"
            className={input}
          />
          <SubmitButton pendingText="Creating…" className={btnPrimary}>
            Create organisation
          </SubmitButton>
          <p className="text-xs text-muted">
            You&rsquo;ll become its administrator.
          </p>
        </form>
      </div>
    );
  }

  // ── Has organisation(s) ───────────────────────────────────────────────────
  return (
    <div className="flex max-w-3xl flex-col gap-7 px-6 py-6 md:px-10">
      {error ? (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}

      <h1 className="font-display text-3xl">Welcome back</h1>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          {memberships.length > 1 ? "Your organisations" : "Your organisation"}
        </h2>
        <ul className="flex flex-col gap-2">
          {memberships.map((m) => (
            <li key={m.organisation_id}>
              <Link
                href="/app/colonies"
                className={`${card} flex items-center justify-between px-4 py-3.5 transition hover:border-accent/50`}
              >
                <span className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-lg bg-accent/10 text-accent">
                    <PawIcon className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="block font-medium">
                      {m.organisations?.name ?? "Organisation"}
                    </span>
                    <span className="block text-xs capitalize text-muted">
                      {m.role}
                    </span>
                  </span>
                </span>
                <ChevronIcon className="h-5 w-5 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Quick links
        </h2>
        <Link
          href="/app/colonies"
          className={`${card} flex items-center gap-3 px-4 py-3.5 transition hover:border-accent/50`}
        >
          <PawIcon className="h-5 w-5 text-accent" />
          <span className="text-sm font-medium">Colonies</span>
          <ChevronIcon className="ml-auto h-5 w-5 text-muted" />
        </Link>
      </section>

      <details className="text-sm text-muted">
        <summary className="cursor-pointer select-none font-medium hover:text-foreground">
          + New organisation
        </summary>
        <form action={createOrganisation} className="mt-3 flex gap-2">
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
      </details>
    </div>
  );
}
