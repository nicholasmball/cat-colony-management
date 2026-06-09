import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getActiveOrg } from "@/lib/active-org";
import { SubmitButton } from "@/components/submit-button";
import { btnGhost, btnPrimary, fieldLabel, input } from "@/lib/ui";
import { createSchedule } from "../actions";
import { getAssignableFeeders } from "../feeders";
import { ScheduleFields } from "../schedule-fields";

const errorClass =
  "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300";

export default async function NewSchedule({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const t = await getTranslations("schedules");

  const org = await getActiveOrg();
  if (!org) redirect("/app");
  // Managers only; feeders see schedules read-only.
  if (org.role !== "admin" && org.role !== "caretaker") {
    redirect(`/app/colonies/${id}`);
  }

  const feeders = await getAssignableFeeders(org.organisation_id);

  return (
    <div className="flex max-w-xl flex-col gap-5 px-6 py-6 md:px-10">
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

      {feeders.length === 0 ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
          {t("noFeeders")}
        </p>
      ) : (
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
      )}
    </div>
  );
}
