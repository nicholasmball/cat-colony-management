"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/active-org";
import { isValidTimeZone } from "@/lib/time";
import { isFailedWrite, writeErrorMessage } from "@/lib/mutation-result";

// Admin-only: edit the organisation's name + notes. RLS ("admin updates
// organisation") backs this up, but re-check the role server-side anyway.
export async function updateOrganisation(formData: FormData) {
  const org = await getActiveOrg();
  if (!org) redirect("/app");
  if (org.role !== "admin") redirect("/app");

  const t = await getTranslations("errors");
  const name = String(formData.get("name") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const timezone = String(formData.get("timezone") ?? "").trim();
  if (!name) {
    redirect(`/app/org?error=${encodeURIComponent(t("orgNameRequired"))}`);
  }
  // Reject anything that isn't a real IANA zone before it reaches day-math.
  if (!isValidTimeZone(timezone)) {
    redirect(`/app/org?error=${encodeURIComponent(t("validTimezone"))}`);
  }

  const supabase = await createClient();
  // Admin gate + server-trusted org scope above are the trust boundary; RLS
  // backs it up. .select("id") + isFailedWrite turns an RLS-filtered 0-row
  // match into a surfaced error instead of a silent success.
  const { data, error } = await supabase
    .from("organisations")
    .update({ name, notes, timezone })
    .eq("id", org.organisation_id)
    .select("id");
  if (isFailedWrite({ error, rows: data })) {
    const message = writeErrorMessage(
      { error, rows: data },
      t("orgNoLongerExists"),
    );
    redirect(`/app/org?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/app/org");
  revalidatePath("/app"); // home card shows the name
  redirect("/app/org?saved=1");
}
