import Link from "next/link";
import { redirect } from "next/navigation";
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
        ← Colony
      </Link>
      <div>
        <h1 className="font-display text-3xl">Add schedule</h1>
        <p className="text-sm text-muted">Assign a feeder to this colony</p>
      </div>

      {error ? (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}

      {feeders.length === 0 ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
          No feeders or caretakers to assign yet. Invite a volunteer from
          Members first.
        </p>
      ) : (
        <form action={createSchedule} className="flex flex-col gap-4">
          <input type="hidden" name="colony_id" value={id} />

          <label className={fieldLabel}>
            <span>Feeder</span>
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
              Approx time{" "}
              <span className="font-normal text-muted">(optional)</span>
            </span>
            <input type="time" name="approx_time" className={input} />
          </label>

          <label className={fieldLabel}>
            <span>
              Notes <span className="font-normal text-muted">(optional)</span>
            </span>
            <textarea
              name="notes"
              rows={3}
              placeholder="e.g. Dry food in the blue bowl"
              className={`${input} py-2`}
            />
          </label>

          <SubmitButton pendingText="Saving…" className={btnPrimary}>
            Save schedule
          </SubmitButton>
          <Link href={`/app/colonies/${id}`} className={btnGhost}>
            Cancel
          </Link>
        </form>
      )}
    </div>
  );
}
