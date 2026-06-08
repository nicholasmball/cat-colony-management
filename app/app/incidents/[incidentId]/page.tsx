import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveOrg } from "@/lib/active-org";
import { photoSrc } from "@/lib/photo";
import { incidentTypeLabel } from "@/lib/incident";
import {
  IncidentStatusPill,
  UrgentBadge,
} from "@/components/incident-status-pill";
import { IncidentTypeIcon } from "@/components/icons";
import { SubmitButton } from "@/components/submit-button";
import { IncidentResolveForm } from "@/components/incident-resolve-form";
import { IncidentAssignForm } from "@/components/incident-assign-form";
import {
  transitionIncident,
  addIncidentComment,
} from "@/app/app/incidents/actions";
import { btnGhost, btnPrimary, card, input, pill } from "@/lib/ui";

const errorClass =
  "rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/60 dark:text-red-300";

type Incident = {
  id: string;
  type: string;
  status: string;
  colony_id: string;
  cat_id: string | null;
  urgency_level_id: string | null;
  reported_by: string | null;
  assigned_to: string | null;
  resolution_note: string | null;
  resolved_at: string | null;
  notes: string | null;
  occurred_at: string;
};

type Comment = {
  id: string;
  author_id: string | null;
  body: string;
  created_at: string;
};

export default async function IncidentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ incidentId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { incidentId } = await params;
  const { error } = await searchParams;
  const org = await getActiveOrg();
  if (!org) redirect("/app");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The incident, org-scoped (RLS also enforces it — a foreign id 404s).
  const { data: incidentData } = await supabase
    .from("incidents")
    .select(
      "id, type, status, colony_id, cat_id, urgency_level_id, reported_by, assigned_to, resolution_note, resolved_at, notes, occurred_at",
    )
    .eq("id", incidentId)
    .eq("organisation_id", org.organisation_id)
    .maybeSingle();
  if (!incidentData) notFound();
  const incident = incidentData as Incident;

  const isManager = org.role === "admin" || org.role === "caretaker";

  // Related reads in parallel — colony, cat, urgency, attachments, comments.
  const [colonyRes, catRes, urgencyRes, attachmentRes, commentRes] =
    await Promise.all([
      supabase
        .from("colonies")
        .select("id, name")
        .eq("id", incident.colony_id)
        .maybeSingle(),
      incident.cat_id
        ? supabase
            .from("cats")
            .select("id, name, temp_id")
            .eq("id", incident.cat_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      incident.urgency_level_id
        ? supabase
            .from("incident_urgency_levels")
            .select("id, alerts_immediately")
            .eq("id", incident.urgency_level_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("attachments")
        .select("storage_path, created_at")
        .eq("entity_type", "incident")
        .eq("entity_id", incident.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: true }),
      supabase
        .from("incident_comments")
        .select("id, author_id, body, created_at")
        .eq("incident_id", incident.id)
        .order("created_at", { ascending: true }),
    ]);

  const colonyName = colonyRes.data?.name ?? "Colony";
  const catLabel = catRes.data
    ? (catRes.data.name ?? catRes.data.temp_id ?? "Unnamed cat")
    : null;
  const urgent = urgencyRes.data?.alerts_immediately === true;
  const comments = (commentRes.data ?? []) as Comment[];
  const photoKey = attachmentRes.data?.[0]?.storage_path ?? null;
  const photo = await photoSrc(photoKey, org.organisation_id);

  // Resolve all the user emails we display: reporter, assignee, comment authors,
  // and (manager only) the org's active managers for the assignee dropdown.
  // One service-client lookup per DISTINCT id — no N+1.
  const svc = createServiceClient();
  const emails = new Map<string, string>();
  const userIds = new Set<string>(
    [
      incident.reported_by,
      incident.assigned_to,
      ...comments.map((c) => c.author_id),
    ].filter((v): v is string => !!v),
  );

  let managers: { id: string; email: string }[] = [];
  if (isManager) {
    // The org's active managers (admin/caretaker) — assignable targets.
    const { data: managerRows } = await svc
      .from("memberships")
      .select("user_id, role")
      .eq("organisation_id", org.organisation_id)
      .in("role", ["admin", "caretaker"])
      .is("deleted_at", null);
    for (const m of managerRows ?? []) userIds.add(m.user_id as string);

    // Resolve every distinct id once, then build the manager list from emails.
    await Promise.all(
      [...userIds].map(async (uid) => {
        const { data } = await svc.auth.admin.getUserById(uid);
        emails.set(uid, data.user?.email ?? "unknown");
      }),
    );
    managers = (managerRows ?? []).map((m) => ({
      id: m.user_id as string,
      email: emails.get(m.user_id as string) ?? "unknown",
    }));
  } else {
    await Promise.all(
      [...userIds].map(async (uid) => {
        const { data } = await svc.auth.admin.getUserById(uid);
        emails.set(uid, data.user?.email ?? "unknown");
      }),
    );
  }

  const reporterEmail = incident.reported_by
    ? (emails.get(incident.reported_by) ?? "unknown")
    : null;
  const assigneeEmail = incident.assigned_to
    ? (emails.get(incident.assigned_to) ?? "unknown")
    : null;

  const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
    timeZone: org.timezone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const isDone = incident.status === "resolved" || incident.status === "closed";

  return (
    <div className="flex max-w-2xl flex-col gap-5 px-6 py-6 md:px-10">
      {isManager ? (
        <Link href="/app/incidents" className="text-sm text-accent">
          ← Incidents
        </Link>
      ) : (
        <Link
          href={`/app/colonies/${incident.colony_id}`}
          className="text-sm text-accent"
        >
          ← {colonyName}
        </Link>
      )}

      {/* ── Header ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-border bg-surface text-foreground">
            <IncidentTypeIcon type={incident.type} className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 font-display text-2xl">
              {incidentTypeLabel(incident.type)}
              {urgent ? <UrgentBadge /> : null}
              <IncidentStatusPill status={incident.status} />
            </h1>
            <p className="text-sm text-muted">
              {colonyName}
              {catLabel ? <> · cat {catLabel}</> : null}
            </p>
          </div>
        </div>
        <p className="text-xs text-muted">
          {reporterEmail ? <>Reported by {reporterEmail} · </> : null}
          {dateTimeFmt.format(new Date(incident.occurred_at))}
        </p>
        {incident.notes ? (
          <p className={`${card} p-3 text-sm`}>{incident.notes}</p>
        ) : null}
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt="Incident photo"
            className="max-h-72 w-full rounded-xl border border-border object-cover"
          />
        ) : null}
      </div>

      {error ? (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}

      {/* ── Resolution summary (terminal) ── */}
      {isDone && incident.resolution_note ? (
        <div
          role="status"
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200"
        >
          <p className="font-medium">
            ✓ Resolved
            {assigneeEmail ? <> by {assigneeEmail}</> : null}
            {incident.resolved_at ? (
              <> · {dateTimeFmt.format(new Date(incident.resolved_at))}</>
            ) : null}
          </p>
          <p className="mt-1">{incident.resolution_note}</p>
        </div>
      ) : null}

      {/* ── Manager action panel — present for managers, ABSENT for feeders. ── */}
      {isManager ? (
        <section className={`${card} flex flex-col gap-4 p-4`}>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Manage incident
          </h2>

          {/* Assignee */}
          <div className="flex flex-col gap-2">
            <p className="text-sm">
              {assigneeEmail ? (
                <>
                  Assigned to <strong>{assigneeEmail}</strong>
                  {incident.assigned_to === user?.id ? (
                    <span className={`ml-2 ${pill}`}>You</span>
                  ) : null}
                </>
              ) : (
                <span className="text-muted">No one is on this yet.</span>
              )}
            </p>
            <IncidentAssignForm
              incidentId={incident.id}
              managers={managers}
              currentUserId={user?.id ?? null}
              assignedTo={incident.assigned_to}
            />
          </div>

          {/* Lifecycle actions */}
          <div className="flex flex-col gap-2 border-t border-border pt-4">
            {incident.status === "open" ? (
              <div className="flex flex-wrap items-center gap-2">
                <form action={transitionIncident}>
                  <input type="hidden" name="incident_id" value={incident.id} />
                  <input type="hidden" name="status" value="in_progress" />
                  <SubmitButton
                    pendingText="…"
                    className={`${btnGhost} min-h-11 text-sm`}
                  >
                    ▷ Start
                  </SubmitButton>
                </form>
                <IncidentResolveForm incidentId={incident.id} />
              </div>
            ) : null}

            {incident.status === "in_progress" ? (
              <IncidentResolveForm incidentId={incident.id} />
            ) : null}

            {isDone ? (
              <div className="flex flex-col gap-1.5">
                <form action={transitionIncident}>
                  <input type="hidden" name="incident_id" value={incident.id} />
                  <input type="hidden" name="status" value="open" />
                  <SubmitButton
                    pendingText="…"
                    className={`${btnGhost} min-h-11 text-sm`}
                  >
                    ↺ Reopen
                  </SubmitButton>
                </form>
                <p className="text-xs text-muted">
                  Reopen sends it back to the queue if something recurs. The
                  resolution note stays in the history.
                </p>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* ── Comment thread — ALL roles read; ALL roles (incl. feeders) post. ── */}
      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Notes ({comments.length})
        </h2>
        {comments.length === 0 ? (
          <p className="text-sm text-muted">No notes yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {comments.map((c) => (
              <li key={c.id} className={`${card} p-3`}>
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <strong className="text-foreground">
                    {c.author_id
                      ? (emails.get(c.author_id) ?? "unknown")
                      : "Someone"}
                  </strong>
                  <span>{dateTimeFmt.format(new Date(c.created_at))}</span>
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{c.body}</p>
              </li>
            ))}
          </ul>
        )}

        {/* Add a note — every role, feeders included (member-insert RLS). */}
        <form action={addIncidentComment} className="flex flex-col gap-2">
          <input type="hidden" name="incident_id" value={incident.id} />
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            <span className="sr-only">Add a note</span>
            <textarea
              name="body"
              rows={2}
              required
              placeholder="Add a note…"
              className={`${input} py-2`}
            />
          </label>
          <SubmitButton
            pendingText="Posting…"
            className={`${btnPrimary} min-h-11 self-start text-sm`}
          >
            Post note
          </SubmitButton>
        </form>
      </section>
    </div>
  );
}
