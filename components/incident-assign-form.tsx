"use client";

import { useTranslations } from "next-intl";
import { SubmitButton } from "@/components/submit-button";
import { assignIncident } from "@/app/app/incidents/actions";
import { btnGhost, btnPrimary, input } from "@/lib/ui";

type Manager = { id: string; email: string };

// Assignee control: a manager dropdown + "Assign to me" / "Unassign" quick
// actions, all posting to assignIncident (server re-validates the target is an
// active manager of the org). Managers only — rendered by omission for feeders
// on the detail page, never as a disabled control.
export function IncidentAssignForm({
  incidentId,
  managers,
  currentUserId,
  assignedTo,
}: {
  incidentId: string;
  managers: Manager[];
  currentUserId: string | null;
  assignedTo: string | null;
}) {
  const t = useTranslations("incidents");
  const tc = useTranslations("common");
  const assignedToMe = !!currentUserId && assignedTo === currentUserId;

  return (
    <div className="flex flex-col gap-2">
      {/* Select + Save: full reassign control. */}
      <form
        action={assignIncident}
        className="flex flex-wrap items-center gap-2"
      >
        <input type="hidden" name="incident_id" value={incidentId} />
        <label className="sr-only" htmlFor={`assign-${incidentId}`}>
          {t("assign.assignTo")}
        </label>
        <select
          id={`assign-${incidentId}`}
          name="assigned_to"
          defaultValue={assignedTo ?? ""}
          className={`${input} min-w-[12rem] flex-1`}
        >
          <option value="">{tc("unassigned")}</option>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id === currentUserId
                ? t("assign.youSuffix", { email: m.email })
                : m.email}
            </option>
          ))}
        </select>
        <SubmitButton
          pendingText={tc("saving")}
          className={`${btnGhost} min-h-11 text-sm`}
        >
          {tc("save")}
        </SubmitButton>
      </form>

      {/* Quick actions. */}
      <div className="flex flex-wrap items-center gap-2">
        {currentUserId && !assignedToMe ? (
          <form action={assignIncident}>
            <input type="hidden" name="incident_id" value={incidentId} />
            <input type="hidden" name="assigned_to" value={currentUserId} />
            <SubmitButton
              pendingText="…"
              className={`${btnPrimary} min-h-11 text-sm`}
            >
              {t("assign.assignToMe")}
            </SubmitButton>
          </form>
        ) : null}
        {assignedTo ? (
          <form action={assignIncident}>
            <input type="hidden" name="incident_id" value={incidentId} />
            <input type="hidden" name="assigned_to" value="" />
            <SubmitButton
              pendingText="…"
              className={`${btnGhost} min-h-11 text-sm`}
            >
              {t("assign.unassign")}
            </SubmitButton>
          </form>
        ) : null}
      </div>
    </div>
  );
}
