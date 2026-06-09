"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveOrg } from "@/lib/active-org";
import { isFailedWrite, writeErrorMessage } from "@/lib/mutation-result";

// A schedulable feeder = an active member whose role is feeder or caretaker.
const ASSIGNABLE_ROLES = new Set(["feeder", "caretaker"]);

// Manager-only gate shared by every action here. UI also hides these, but the
// server must never trust that.
async function requireManagerOrg() {
  const org = await getActiveOrg();
  if (!org) redirect("/app");
  if (org.role !== "admin" && org.role !== "caretaker") {
    redirect(`/app/colonies`);
  }
  return org;
}

// Validate that `feederId` is an active feeder/caretaker member of the org.
async function feederIsAssignable(
  organisationId: string,
  feederId: string,
): Promise<boolean> {
  const svc = createServiceClient();
  const { data } = await svc
    .from("memberships")
    .select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", feederId)
    .is("deleted_at", null)
    .maybeSingle();
  return !!data && ASSIGNABLE_ROLES.has(data.role as string);
}

// Selected weekday checkboxes arrive as repeated "weekday" fields ("0".."6").
function parseWeekdays(formData: FormData): number[] {
  const out = new Set<number>();
  for (const v of formData.getAll("weekday")) {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 0 && n <= 6) out.add(n);
  }
  return [...out];
}

export async function createSchedule(formData: FormData) {
  const colonyId = String(formData.get("colony_id"));
  const org = await requireManagerOrg();
  const t = await getTranslations("errors");
  const newPath = `/app/colonies/${colonyId}/schedules/new`;

  const feederId = String(formData.get("feeder_id") ?? "");
  if (!feederId || !(await feederIsAssignable(org.organisation_id, feederId))) {
    redirect(`${newPath}?error=${encodeURIComponent(t("chooseFeeder"))}`);
  }

  const approxTime = String(formData.get("approx_time") ?? "") || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const type = String(formData.get("type") ?? "weekly");

  const base = {
    organisation_id: org.organisation_id,
    colony_id: colonyId,
    feeder_id: feederId,
    approx_time: approxTime,
    notes,
  };

  let rows: Array<Record<string, unknown>>;
  if (type === "one_off") {
    const date = String(formData.get("specific_date") ?? "");
    if (!date) {
      redirect(`${newPath}?error=${encodeURIComponent(t("pickOneOffDate"))}`);
    }
    rows = [{ ...base, specific_date: date, weekday: null }];
  } else {
    const weekdays = parseWeekdays(formData);
    if (weekdays.length === 0) {
      redirect(`${newPath}?error=${encodeURIComponent(t("chooseWeekday"))}`);
    }
    // One DB row per selected weekday so Today's filter is a plain weekday match.
    rows = weekdays.map((w) => ({ ...base, weekday: w, specific_date: null }));
  }

  const supabase = await createClient();
  // RLS also enforces org + manager role on insert.
  const { error } = await supabase.from("feeding_schedules").insert(rows);
  if (error) {
    redirect(`${newPath}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/app/colonies/${colonyId}`);
  redirect(`/app/colonies/${colonyId}`);
}

export async function updateSchedule(formData: FormData) {
  const colonyId = String(formData.get("colony_id"));
  const scheduleId = String(formData.get("schedule_id"));
  const org = await requireManagerOrg();
  const t = await getTranslations("errors");
  const editPath = `/app/colonies/${colonyId}/schedules/${scheduleId}/edit`;

  const feederId = String(formData.get("feeder_id") ?? "");
  if (!feederId || !(await feederIsAssignable(org.organisation_id, feederId))) {
    redirect(`${editPath}?error=${encodeURIComponent(t("chooseFeeder"))}`);
  }

  const approxTime = String(formData.get("approx_time") ?? "") || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const isActive = formData.get("is_active") === "on";

  // requireManagerOrg above is the trust boundary. Write through the
  // service-role client (RLS bypassed) and scope by org explicitly so the
  // update can never silently match 0 rows because of a missing JWT, and can
  // never cross orgs. Mirrors the proven deactivateMember pattern.
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("feeding_schedules")
    .update({
      feeder_id: feederId,
      approx_time: approxTime,
      notes,
      is_active: isActive,
    })
    .eq("id", scheduleId)
    .eq("organisation_id", org.organisation_id)
    .select("id");
  if (isFailedWrite({ error, rows: data })) {
    const message = writeErrorMessage(
      { error, rows: data },
      t("scheduleNoLongerExists"),
    );
    redirect(`${editPath}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath(`/app/colonies/${colonyId}`);
  redirect(`/app/colonies/${colonyId}`);
}

export async function deleteSchedule(formData: FormData) {
  const colonyId = String(formData.get("colony_id"));
  const scheduleId = String(formData.get("schedule_id"));
  const org = await requireManagerOrg();
  const t = await getTranslations("errors");

  // requireManagerOrg above is the real trust boundary. Soft-delete through the
  // service-role client (RLS bypassed) scoped to id + org — the RLS-bound
  // client could not reliably present auth.uid() in this server-action write
  // context, so the manager UPDATE policy filtered the row out and the write
  // was a silent 0-row no-op. .select() + isFailedWrite makes 0 rows an error.
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("feeding_schedules")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", scheduleId)
    .eq("organisation_id", org.organisation_id)
    .select("id");
  if (isFailedWrite({ error, rows: data })) {
    const message = writeErrorMessage(
      { error, rows: data },
      t("scheduleNoLongerExists"),
    );
    redirect(`/app/colonies/${colonyId}?error=${encodeURIComponent(message)}`);
  }

  revalidatePath(`/app/colonies/${colonyId}`);
  redirect(`/app/colonies/${colonyId}`);
}
