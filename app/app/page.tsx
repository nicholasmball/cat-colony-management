import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createOrganisation, switchOrg } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { PawIcon, ChevronIcon } from "@/components/icons";
import { EmptyState } from "@/components/empty-state";
import { getActiveOrg } from "@/lib/active-org";
import { firstRunStep } from "@/lib/onboarding";
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

  // ── First-run: active org exists but is still empty → guided welcome ──────
  // Active org honours the switcher cookie (falls back to earliest membership).
  const active = await getActiveOrg();
  const canManage =
    active?.role === "admin" || active?.role === "caretaker";
  const orgName = active?.name ?? "your colony";

  let colonyCount = 0;
  let catCount = 0;
  let firstColonyId: string | undefined;
  if (active) {
    const { data: colonyRows, count } = await supabase
      .from("colonies")
      .select("id", { count: "exact" })
      .eq("organisation_id", active.organisation_id)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(1);
    colonyCount = count ?? 0;
    firstColonyId = colonyRows?.[0]?.id as string | undefined;
    if (colonyCount > 0) {
      const { count: cats } = await supabase
        .from("cats")
        .select("id", { count: "exact", head: true })
        .eq("organisation_id", active.organisation_id)
        .is("deleted_at", null);
      catCount = cats ?? 0;
    }
  }
  const step = firstRunStep({ colonies: colonyCount, cats: catCount });

  if (active && step !== "done") {
    const steps = [
      { label: "Add your first colony", state: step === "colony" ? "now" : "done" },
      {
        label: "Add a cat to it",
        state: step === "cat" ? "now" : step === "colony" ? "todo" : "done",
      },
      { label: "Set a feeding schedule", state: "soon" as const },
    ];
    const ctaHref =
      step === "colony"
        ? "/app/colonies/new"
        : `/app/colonies/${firstColonyId}/cats/new`;
    const ctaLabel = step === "colony" ? "Add your first colony" : "Add a cat";

    return (
      <div className="mx-auto flex max-w-md flex-col gap-5 px-6 py-8">
        {error ? (
          <p role="alert" className={errorClass}>
            {error}
          </p>
        ) : null}
        <div className="space-y-1">
          <h1 className="font-display text-3xl">Welcome to {orgName} 🐾</h1>
          <p className="text-sm text-muted">
            {canManage
              ? "Let’s get set up — a couple of quick steps."
              : "Your colony is being set up."}
          </p>
        </div>

        {canManage ? (
          <div className={`${card} flex flex-col gap-4 p-5`}>
            <ol className="flex flex-col gap-3">
              {steps.map((s, i) => (
                <li key={s.label} className="flex items-center gap-3 text-sm">
                  <span
                    aria-hidden
                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
                      s.state === "done"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                        : s.state === "now"
                          ? "bg-accent/10 text-accent"
                          : "bg-foreground/5 text-muted"
                    }`}
                  >
                    {s.state === "done" ? "✓" : i + 1}
                  </span>
                  <span
                    className={
                      s.state === "now" ? "font-medium" : "text-muted"
                    }
                  >
                    {s.label}
                  </span>
                  {s.state === "soon" ? (
                    <span className="ml-auto rounded bg-foreground/5 px-1.5 py-0.5 text-[0.65rem] text-muted">
                      soon
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
            <Link href={ctaHref} className={btnPrimary}>
              {ctaLabel} →
            </Link>
          </div>
        ) : (
          <EmptyState
            icon={<PawIcon className="h-7 w-7" />}
            title="Nothing here yet"
            body="Your caretaker will set up colonies and assign you feeds. Check back soon."
          />
        )}
      </div>
    );
  }

  // ── Has organisation(s): fully set up → normal home ───────────────────────
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
          {memberships.map((m) => {
            const isActive = m.organisation_id === active?.organisation_id;
            return (
              <li key={m.organisation_id}>
                {/* A form (not a link) so switching the active org is a POST —
                    avoids Next prefetch silently changing the active org. */}
                <form action={switchOrg}>
                  <input
                    type="hidden"
                    name="org"
                    value={m.organisation_id}
                  />
                  <button
                    type="submit"
                    className={`${card} flex w-full items-center justify-between px-4 py-3.5 text-left transition hover:border-accent/50 ${
                      isActive ? "border-accent/60" : ""
                    }`}
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
                          {isActive ? " · active" : ""}
                        </span>
                      </span>
                    </span>
                    <ChevronIcon className="h-5 w-5 text-muted" />
                  </button>
                </form>
              </li>
            );
          })}
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
