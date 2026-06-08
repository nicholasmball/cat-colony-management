import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/active-org";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmButton } from "@/components/confirm-button";
import {
  btnGhost,
  btnGhostDanger,
  btnPrimary,
  fieldLabel,
  input,
} from "@/lib/ui";
import { scheduleWhen } from "@/lib/schedule";
import { updateSchedule, deleteSchedule } from "../../actions";
import { getAssignableFeeders } from "../../feeders";

const errorClass =
  "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300";

export default async function EditSchedule({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; sid: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id, sid } = await params;
  const { error } = await searchParams;

  const org = await getActiveOrg();
  if (!org) redirect("/app");
  if (org.role !== "admin" && org.role !== "caretaker") {
    redirect(`/app/colonies/${id}`);
  }

  const supabase = await createClient();
  const { data: schedule } = await supabase
    .from("feeding_schedules")
    .select(
      "id, feeder_id, weekday, specific_date, approx_time, notes, is_active",
    )
    .eq("id", sid)
    .is("deleted_at", null)
    .maybeSingle();
  if (!schedule) notFound();

  const feeders = await getAssignableFeeders(org.organisation_id);
  const when = scheduleWhen({
    weekday: schedule.weekday as number | null,
    specific_date: schedule.specific_date as string | null,
  });
  const typeLabel = schedule.specific_date ? "★ One-off" : "⟳ Weekly";

  return (
    <div className="flex max-w-xl flex-col gap-5 px-6 py-6 md:px-10">
      <Link href={`/app/colonies/${id}`} className="text-sm text-accent">
        ← Colony
      </Link>
      <div>
        <h1 className="font-display text-3xl">Edit schedule</h1>
        <p className="text-sm text-muted">
          {typeLabel} · {when}
        </p>
      </div>

      {error ? (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}

      <form action={updateSchedule} className="flex flex-col gap-4">
        <input type="hidden" name="colony_id" value={id} />
        <input type="hidden" name="schedule_id" value={sid} />

        <label className={fieldLabel}>
          <span>Feeder</span>
          <select
            name="feeder_id"
            required
            defaultValue={(schedule.feeder_id as string | null) ?? ""}
            className={input}
          >
            {feeders.map((f) => (
              <option key={f.user_id} value={f.user_id}>
                {f.email}
              </option>
            ))}
          </select>
        </label>

        <label className={fieldLabel}>
          <span>
            Approx time{" "}
            <span className="font-normal text-muted">(optional)</span>
          </span>
          <input
            type="time"
            name="approx_time"
            defaultValue={
              (schedule.approx_time as string | null)?.slice(0, 5) ?? ""
            }
            className={input}
          />
        </label>

        <label className={fieldLabel}>
          <span>
            Notes <span className="font-normal text-muted">(optional)</span>
          </span>
          <textarea
            name="notes"
            rows={3}
            defaultValue={(schedule.notes as string | null) ?? ""}
            className={`${input} py-2`}
          />
        </label>

        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            name="is_active"
            defaultChecked={schedule.is_active as boolean}
            className="h-5 w-5 rounded border-border"
          />
          <span>Active</span>
        </label>

        <SubmitButton pendingText="Saving…" className={btnPrimary}>
          Save changes
        </SubmitButton>
        <Link href={`/app/colonies/${id}`} className={btnGhost}>
          Cancel
        </Link>
      </form>

      <form action={deleteSchedule}>
        <input type="hidden" name="colony_id" value={id} />
        <input type="hidden" name="schedule_id" value={sid} />
        <ConfirmButton
          confirm="Remove this schedule?"
          className={`${btnGhostDanger} text-sm`}
        >
          Delete schedule
        </ConfirmButton>
      </form>
    </div>
  );
}
