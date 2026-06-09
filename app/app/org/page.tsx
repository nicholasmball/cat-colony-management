import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLocale, getTranslations } from "next-intl/server";
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
  const t = await getTranslations("org");
  const locale = await getLocale();
  const displayLocale = locale === "pt" ? "pt-PT" : "en-GB";

  const supabase = await createClient();
  const { data } = await supabase
    .from("organisations")
    .select("name, notes, created_at, timezone")
    .eq("id", org.organisation_id)
    .maybeSingle();

  const created = data?.created_at
    ? new Date(data.created_at).toLocaleDateString(displayLocale, {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  // Curated shortlist; the org's stored zone is always pinned in so it's never
  // lost even if it isn't one of the common picks.
  const current = data?.timezone ?? "Europe/Lisbon";
  const COMMON = [
    "Europe/Lisbon",
    "Atlantic/Azores",
    "Europe/Madrid",
    "Europe/London",
    "UTC",
  ];
  const zones = COMMON.includes(current) ? COMMON : [current, ...COMMON];
  // Render-time confirmation of the current local date/time in that zone.
  const localNow = new Intl.DateTimeFormat(displayLocale, {
    timeZone: current,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

  return (
    <div className="flex max-w-xl flex-col gap-5 px-6 py-6 md:px-10">
      <div>
        <h1 className="font-display text-3xl">{t("title")}</h1>
        {created ? (
          <p className="text-sm text-muted">
            {t("createdOn", { date: created })}
          </p>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}
      {saved ? <p className={okClass}>{t("savedToast")}</p> : null}

      <form
        action={updateOrganisation}
        className={`${card} flex flex-col gap-4 p-4`}
      >
        <label className={fieldLabel}>
          <span>{t("name")}</span>
          <input
            name="name"
            required
            defaultValue={data?.name ?? ""}
            className={input}
          />
        </label>
        <label className={fieldLabel}>
          <span>{t("notes")}</span>
          <textarea
            name="notes"
            rows={4}
            defaultValue={data?.notes ?? ""}
            placeholder={t("notesPlaceholder")}
            className={`${input} py-2`}
          />
        </label>
        <label className={fieldLabel}>
          <span>{t("timezone")}</span>
          <select name="timezone" defaultValue={current} className={input}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
          <span className="text-xs font-normal text-muted">
            {t("timezoneHint", { time: localNow })}
          </span>
        </label>
        <SubmitButton
          pendingText={t("saving")}
          className={`${btnPrimary} self-start`}
        >
          {t("saveChanges")}
        </SubmitButton>
      </form>
    </div>
  );
}
