import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { createOrganisation, switchOrg } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { PawIcon, ChevronIcon } from "@/components/icons";
import { EmptyState } from "@/components/empty-state";
import { getActiveOrg } from "@/lib/active-org";
import { firstRunStep } from "@/lib/onboarding";
import { firstRunDestination, getPendingInvite } from "@/lib/pending-invite";
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
  const t = await getTranslations("appHome");
  const tRole = await getTranslations("members.role");
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
    // An invitee who signs in before accepting has no membership yet, but they
    // shouldn't be offered create-org — send them to /accept, which resolves the
    // pending invite by their signed-in email.
    const pendingInvite = user.email
      ? await getPendingInvite(user.email)
      : null;
    if (
      firstRunDestination({
        hasMembership: false,
        hasPendingInvite: pendingInvite !== null,
      }) === "accept"
    ) {
      redirect("/accept");
    }

    return (
      <div className="mx-auto flex max-w-md flex-col gap-5 p-6">
        {error ? (
          <p role="alert" className={errorClass}>
            {error}
          </p>
        ) : null}
        <div className="space-y-1">
          <h1 className="font-display text-3xl">{t("welcome")}</h1>
          <p className="text-sm text-muted">{t("setupLede")}</p>
        </div>
        <form
          action={createOrganisation}
          className={`${card} flex flex-col gap-3 p-5`}
        >
          <label className="text-sm font-medium" htmlFor="org-name">
            {t("orgName")}
          </label>
          <input
            id="org-name"
            name="name"
            required
            placeholder={t("orgNamePlaceholder")}
            className={input}
          />
          <SubmitButton pendingText={t("creating")} className={btnPrimary}>
            {t("createOrg")}
          </SubmitButton>
          <p className="text-xs text-muted">{t("becomeAdmin")}</p>
        </form>
      </div>
    );
  }

  // ── First-run: active org exists but is still empty → guided welcome ──────
  // Active org honours the switcher cookie (falls back to earliest membership).
  const active = await getActiveOrg();
  const canManage = active?.role === "admin" || active?.role === "caretaker";
  const orgName = active?.name ?? t("organisationFallback");

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
  // Feeders land on Today once their org has colonies to feed. A feeder with no
  // colonies falls through to the "nothing here yet" guidance below; managers
  // keep this home screen.
  if (active?.role === "feeder" && colonyCount > 0) {
    redirect("/app/today");
  }

  const step = firstRunStep({ colonies: colonyCount, cats: catCount });

  if (active && step !== "done") {
    const steps = [
      {
        label: t("stepAddColony"),
        state: step === "colony" ? "now" : "done",
      },
      {
        label: t("stepAddCat"),
        state: step === "cat" ? "now" : step === "colony" ? "todo" : "done",
      },
      { label: t("stepSetSchedule"), state: "soon" as const },
    ];
    const ctaHref =
      step === "colony"
        ? "/app/colonies/new"
        : `/app/colonies/${firstColonyId}/cats/new`;
    const ctaLabel = step === "colony" ? t("addFirstColony") : t("addCat");

    return (
      <div className="mx-auto flex max-w-md flex-col gap-5 px-6 py-8">
        {error ? (
          <p role="alert" className={errorClass}>
            {error}
          </p>
        ) : null}
        <div className="space-y-1">
          <h1 className="font-display text-3xl">
            {t("welcomeToOrg", { org: orgName })}
          </h1>
          <p className="text-sm text-muted">
            {canManage ? t("setupSteps") : t("colonyBeingSetUp")}
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
                    className={s.state === "now" ? "font-medium" : "text-muted"}
                  >
                    {s.label}
                  </span>
                  {s.state === "soon" ? (
                    <span className="ml-auto rounded bg-foreground/5 px-1.5 py-0.5 text-[0.65rem] text-muted">
                      {t("soon")}
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
            title={t("nothingYetTitle")}
            body={t("nothingYetBody")}
          />
        )}
      </div>
    );
  }

  // ── Has organisation(s): fully set up ─────────────────────────────────────
  // Managers land on their oversight dashboard (approved). This sits AFTER the
  // first-run/empty-org handling and AFTER the feeder→Today redirect above, so
  // it never hijacks onboarding or feeders — only a fully-set-up manager. /app
  // stays reachable as this landing router (the org switcher below still
  // renders for anyone who navigates here directly via the nav-less route).
  if (active && canManage) {
    redirect("/app/dashboard");
  }

  // ── Fully set up, non-manager fallthrough → org switcher / quick links ─────
  return (
    <div className="flex max-w-3xl flex-col gap-7 px-6 py-6 md:px-10">
      {error ? (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}

      <h1 className="font-display text-3xl">{t("welcomeBack")}</h1>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          {memberships.length > 1
            ? t("yourOrganisations")
            : t("yourOrganisation")}
        </h2>
        <ul className="flex flex-col gap-2">
          {memberships.map((m) => {
            const isActive = m.organisation_id === active?.organisation_id;
            return (
              <li key={m.organisation_id}>
                {/* A form (not a link) so switching the active org is a POST —
                    avoids Next prefetch silently changing the active org. */}
                <form action={switchOrg}>
                  <input type="hidden" name="org" value={m.organisation_id} />
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
                          {m.organisations?.name ?? t("organisationFallback")}
                        </span>
                        <span className="block text-xs capitalize text-muted">
                          {tRole(m.role)}
                          {isActive ? t("activeSuffix") : ""}
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
          {t("quickLinks")}
        </h2>
        <Link
          href="/app/colonies"
          className={`${card} flex items-center gap-3 px-4 py-3.5 transition hover:border-accent/50`}
        >
          <PawIcon className="h-5 w-5 text-accent" />
          <span className="text-sm font-medium">{t("colonies")}</span>
          <ChevronIcon className="ml-auto h-5 w-5 text-muted" />
        </Link>
      </section>

      <details className="text-sm text-muted">
        <summary className="cursor-pointer select-none font-medium hover:text-foreground">
          {t("newOrganisation")}
        </summary>
        <form action={createOrganisation} className="mt-3 flex gap-2">
          <input
            name="name"
            required
            placeholder={t("organisationNamePlaceholder")}
            className={`${input} flex-1`}
          />
          <SubmitButton pendingText={t("creating")} className={btnPrimary}>
            {t("create")}
          </SubmitButton>
        </form>
      </details>
    </div>
  );
}
