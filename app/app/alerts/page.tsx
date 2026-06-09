import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/active-org";
import { SubmitButton } from "@/components/submit-button";
import { btnPrimary, card, fieldLabel, input, pill } from "@/lib/ui";
import {
  DEFAULT_FEEDING_MISSED_HOURS,
  DEFAULT_NOT_SEEN_DAYS,
  DEFAULT_REPEATED_NOT_SEEN,
  ALERT_BOUNDS,
} from "@/lib/alert-settings";
import { updateAlertSettings } from "./actions";

const errorClass =
  "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300";
const okClass =
  "rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300";

// Manager-gated (admin + caretaker) editor for the org's three alert thresholds.
// Mirrors the Org settings page pattern: maybeSingle() prefill, <form action=…>,
// fieldLabel/input/SubmitButton, ?error= / ?saved=1 toast. A row is normally
// auto-created on org creation; if absent we prefill the engine defaults and flag
// each field "Using default" so the manager knows the value is inherited.
export default async function AlertSettings({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const org = await getActiveOrg();
  if (!org) redirect("/app");
  // Same guard the dashboard uses — both manager roles tune thresholds.
  if (org.role !== "admin" && org.role !== "caretaker") redirect("/app/today");

  const { error, saved } = await searchParams;
  const t = await getTranslations("alertSettings");

  const supabase = await createClient();
  const { data } = await supabase
    .from("alert_settings")
    .select("not_seen_days, repeated_not_seen, feeding_missed_hours")
    .eq("organisation_id", org.organisation_id)
    .maybeSingle();

  // No row → fall back to the engine defaults (7 / 3 / 12) and show the badge.
  const usingDefault = data == null;
  const notSeenDays = data?.not_seen_days ?? DEFAULT_NOT_SEEN_DAYS;
  const repeatedNotSeen = data?.repeated_not_seen ?? DEFAULT_REPEATED_NOT_SEEN;
  const feedingMissedHours =
    data?.feeding_missed_hours ?? DEFAULT_FEEDING_MISSED_HOURS;

  const fields = [
    {
      name: "not_seen_days",
      label: t("notSeenLabel"),
      hint: t("notSeenHint"),
      unit: t("unitDays"),
      value: notSeenDays,
      bounds: ALERT_BOUNDS.not_seen_days,
    },
    {
      name: "repeated_not_seen",
      label: t("repeatedLabel"),
      hint: t("repeatedHint"),
      unit: t("unitVisits"),
      value: repeatedNotSeen,
      bounds: ALERT_BOUNDS.repeated_not_seen,
    },
    {
      name: "feeding_missed_hours",
      label: t("missedLabel"),
      hint: t("missedHint"),
      unit: t("unitHours"),
      value: feedingMissedHours,
      bounds: ALERT_BOUNDS.feeding_missed_hours,
    },
  ];

  return (
    <div className="flex max-w-xl flex-col gap-5 px-6 py-6 md:px-10">
      <div>
        <h1 className="font-display text-3xl">{t("title")}</h1>
        <p className="text-sm text-muted">{t("subtitle")}</p>
      </div>

      {error ? (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className={okClass}>
          {t("savedToast")}
        </p>
      ) : null}

      <form
        action={updateAlertSettings}
        className={`${card} flex flex-col gap-5 p-4`}
      >
        {fields.map((f) => (
          <label key={f.name} className={fieldLabel}>
            <span className="flex flex-wrap items-center gap-2">
              {f.label}
              {usingDefault ? (
                <span className={pill}>{t("usingDefault")}</span>
              ) : null}
            </span>
            <span
              id={`${f.name}-hint`}
              className="text-xs font-normal text-muted"
            >
              {f.hint}
            </span>
            <span className="flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                name={f.name}
                required
                min={f.bounds.min}
                max={f.bounds.max}
                step={1}
                defaultValue={f.value}
                aria-describedby={`${f.name}-hint`}
                className={`${input} w-24 text-center`}
              />
              <span className="text-sm font-normal text-muted">{f.unit}</span>
            </span>
          </label>
        ))}
        <SubmitButton
          pendingText={t("saving")}
          className={`${btnPrimary} self-start`}
        >
          {t("save")}
        </SubmitButton>
      </form>
    </div>
  );
}
