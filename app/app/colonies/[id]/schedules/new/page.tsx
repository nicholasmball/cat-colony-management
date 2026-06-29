import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getActiveOrg } from "@/lib/active-org";
import { SubmitButton } from "@/components/submit-button";
import { ScheduleInvitePanel } from "@/components/schedule-invite-panel";
import { btnGhost, btnPrimary, fieldLabel, input } from "@/lib/ui";
import { createSchedule } from "../actions";
import { getAssignableFeeders, getPendingFeederInvites } from "../feeders";
import { ScheduleFields } from "../schedule-fields";

const errorClass =
  "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300";
const okClass =
  "rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300";
const warnClass =
  "flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200";

export default async function NewSchedule({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; invited?: string; sent?: string }>;
}) {
  const { id } = await params;
  const { error, invited } = await searchParams;
  const t = await getTranslations("schedules");

  const org = await getActiveOrg();
  if (!org) redirect("/app");
  // Managers only; feeders see schedules read-only.
  if (org.role !== "admin" && org.role !== "caretaker") {
    redirect(`/app/colonies/${id}`);
  }
  // The inline invite affordance is admin-only — caretakers see the form
  // exactly as before. inviteVolunteer re-checks this server-side regardless.
  const canInvite = org.role === "admin";

  const feeders = await getAssignableFeeders(org.organisation_id);
  const pendingInvites = canInvite
    ? await getPendingFeederInvites(org.organisation_id)
    : [];

  const header = (
    <>
      <Link href={`/app/colonies/${id}`} className="text-sm text-accent">
        {t("backToColony")}
      </Link>
      <div>
        <h1 className="font-display text-3xl">{t("addTitle")}</h1>
        <p className="text-sm text-muted">{t("addSubtitle")}</p>
      </div>
      {error ? (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}
    </>
  );

  // ── 0-feeders empty state ──────────────────────────────────────────────────
  // No assignable feeder yet, so there is nothing to save. For admins, the
  // invite affordance is the way forward (pre-expanded); for caretakers it stays
  // the shipped explanation (they can't invite — that's admin-only).
  if (feeders.length === 0) {
    return (
      <div className="flex max-w-xl flex-col gap-5 px-6 py-6 md:px-10">
        {header}
        {canInvite ? (
          invited ? (
            <>
              <p role="status" className={okClass}>
                {t("invite.successEmpty", { email: invited })}
              </p>
              <p className={warnClass}>
                <span aria-hidden="true">◷</span>
                <span>{t("invite.waiting", { email: invited })}</span>
              </p>
              <Link href={`/app/colonies/${id}`} className={btnGhost}>
                {t("invite.backToColony")}
              </Link>
            </>
          ) : (
            <>
              <p className={warnClass}>
                <span aria-hidden="true">⚠</span>
                <span>{t("invite.emptyWarning")}</span>
              </p>
              <ScheduleInvitePanel
                colonyId={id}
                variant="empty"
                forceExpanded
              />
              <Link href={`/app/colonies/${id}`} className={btnGhost}>
                {t("invite.backToColony")}
              </Link>
            </>
          )
        ) : (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
            {t("noFeeders")}
          </p>
        )}
      </div>
    );
  }

  // ── Normal state: ≥1 assignable feeder ─────────────────────────────────────
  return (
    <div className="flex max-w-xl flex-col gap-5 px-6 py-6 md:px-10">
      {header}

      <form action={createSchedule} className="flex flex-col gap-4">
        <input type="hidden" name="colony_id" value={id} />

        <label className={fieldLabel}>
          <span>{t("feeder")}</span>
          <select name="feeder_id" required className={input}>
            {feeders.map((f) => (
              <option key={f.user_id} value={f.user_id}>
                {f.email}
              </option>
            ))}
          </select>
        </label>

        {/* Admin-only inline invite: success confirmation + read-only pending
            list + the disclosure. Never part of the feeder <select> above. */}
        {canInvite ? (
          <>
            {pendingInvites.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {pendingInvites.map((inv) => (
                  <li
                    key={inv.email}
                    className="flex items-center gap-2 rounded-lg border border-dashed border-border bg-foreground/[0.02] px-3 py-2 text-xs text-muted"
                  >
                    <span className="min-w-0 truncate font-medium text-foreground/70">
                      {inv.email}
                    </span>
                    <span className="ml-auto inline-flex flex-none items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-semibold text-muted">
                      <span aria-hidden="true">◷</span>
                      {t("invite.pendingTag")}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {invited ? (
              <p role="status" className={okClass}>
                {t("invite.successNormal", { email: invited })}
              </p>
            ) : null}
            <ScheduleInvitePanel colonyId={id} />
          </>
        ) : null}

        <ScheduleFields />

        <label className={fieldLabel}>
          <span>
            {t("approxTime")}{" "}
            <span className="font-normal text-muted">({t("optional")})</span>
          </span>
          <input type="time" name="approx_time" className={input} />
        </label>

        <label className={fieldLabel}>
          <span>
            {t("notes")}{" "}
            <span className="font-normal text-muted">({t("optional")})</span>
          </span>
          <textarea
            name="notes"
            rows={3}
            placeholder={t("notesPlaceholder")}
            className={`${input} py-2`}
          />
        </label>

        <SubmitButton pendingText={t("saving")} className={btnPrimary}>
          {t("saveSchedule")}
        </SubmitButton>
        <Link href={`/app/colonies/${id}`} className={btnGhost}>
          {t("cancel")}
        </Link>
      </form>
    </div>
  );
}
