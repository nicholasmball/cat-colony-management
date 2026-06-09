"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/active-org";
import { isFailedWrite, writeErrorMessage } from "@/lib/mutation-result";
import {
  parseAlertSettings,
  type AlertSettingsField,
} from "@/lib/alert-settings";

// Manager-only (admin + caretaker): edit the org's three alert thresholds. RLS
// ("managers upsert/update alert_settings") backs this up, but re-check the role
// server-side anyway — the same trust boundary the org action uses.
export async function updateAlertSettings(formData: FormData) {
  const org = await getActiveOrg();
  if (!org) redirect("/app");
  if (org.role !== "admin" && org.role !== "caretaker") redirect("/app/today");

  const t = await getTranslations("errors");

  // Validate + bound on the server too (the form's min/max is only a hint): a
  // JS-off or tampered submit must still be rejected before it reaches the DB.
  const parsed = parseAlertSettings({
    notSeenDays: formData.get("not_seen_days") as string | null,
    repeatedNotSeen: formData.get("repeated_not_seen") as string | null,
    feedingMissedHours: formData.get("feeding_missed_hours") as string | null,
  });
  if (!parsed.ok) {
    const errorByField: Record<AlertSettingsField, string> = {
      not_seen_days: t("alertNotSeenRange"),
      repeated_not_seen: t("alertRepeatedRange"),
      feeding_missed_hours: t("alertMissedRange"),
    };
    redirect(
      `/app/alerts?error=${encodeURIComponent(errorByField[parsed.field])}`,
    );
  }

  const supabase = await createClient();
  // Upsert the 1:1 row (a row normally exists from org creation, but upsert
  // covers the no-row case too). .select() + isFailedWrite turns an RLS-filtered
  // 0-row result into a surfaced error instead of a silent success.
  const { data, error } = await supabase
    .from("alert_settings")
    .upsert(
      { organisation_id: org.organisation_id, ...parsed.value },
      { onConflict: "organisation_id" },
    )
    .select("organisation_id");
  if (isFailedWrite({ error, rows: data })) {
    const message = writeErrorMessage(
      { error, rows: data },
      t("alertSettingsNoLongerExist"),
    );
    redirect(`/app/alerts?error=${encodeURIComponent(message)}`);
  }

  // The thresholds drive concern + feeding-missed status everywhere they're
  // shown, so revalidate every surface that reads them.
  revalidatePath("/app/alerts");
  revalidatePath("/app/dashboard");
  revalidatePath("/app/today");
  revalidatePath("/app/colonies");
  redirect("/app/alerts?saved=1");
}
