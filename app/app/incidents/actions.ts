"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveOrg } from "@/lib/active-org";
import { isFailedWrite, writeErrorMessage } from "@/lib/mutation-result";
import { canTransitionIncident } from "@/lib/incident-status";

// IMPORTANT: this module imports ZERO alert/notification code. Triage is a pure
// status/assignment/comment surface; a later alert engine reads the rows.

const LIST = "/app/incidents";

// A manager (admin/caretaker) of the active org may triage. Mirrors the
// schedules actions' requireManagerOrg — UI also hides these, but the server is
// the trust boundary and never trusts that.
async function requireManagerOrg() {
  const org = await getActiveOrg();
  if (!org) redirect("/app");
  if (org.role !== "admin" && org.role !== "caretaker") redirect("/app/today");
  return org;
}

// Roles that may be assigned an incident: an active manager (admin/caretaker)
// of the org. Mirrors feederIsAssignable, but gated to managers — a feeder must
// never be assigned an incident they can't action.
const MANAGER_ASSIGNABLE = new Set(["admin", "caretaker"]);

async function managerIsAssignable(
  organisationId: string,
  userId: string,
): Promise<boolean> {
  const svc = createServiceClient();
  const { data } = await svc
    .from("memberships")
    .select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  return !!data && MANAGER_ASSIGNABLE.has(data.role as string);
}

function detailPath(id: string) {
  return `${LIST}/${id}`;
}

// ── transitionIncident ───────────────────────────────────────────────────────
// Move an incident along the lifecycle (Start / Mark resolved / Reopen). Gated
// by requireManagerOrg AND the pure canTransitionIncident matrix AND RLS
// ("managers update incidents"). Resolving requires a non-empty note.
export async function transitionIncident(formData: FormData) {
  const org = await requireManagerOrg();
  const incidentId = String(formData.get("incident_id") ?? "");
  const target = String(formData.get("status") ?? "");
  const detail = detailPath(incidentId);
  function fail(message: string): never {
    redirect(`${detail}?error=${encodeURIComponent(message)}`);
  }

  // Load the incident's current status, scoped to the active org, via the
  // service client (requireManagerOrg is the trust boundary; explicit org scope
  // means a foreign id can never be read or written).
  const svc = createServiceClient();
  const { data: incident } = await svc
    .from("incidents")
    .select("id, status")
    .eq("id", incidentId)
    .eq("organisation_id", org.organisation_id)
    .maybeSingle();
  if (!incident) fail("That incident no longer exists.");

  const decision = canTransitionIncident({
    actorRole: org.role,
    from: incident.status as string,
    to: target,
  });
  if (!decision.ok) fail(decision.reason);
  if (decision.noop) redirect(detail);

  // Build the patch per target. resolve sets the audit fields + requires a
  // note; reopen clears resolved_at but KEEPS resolution_note as history.
  const patch: Record<string, unknown> = { status: target };
  if (target === "resolved") {
    const note = String(formData.get("resolution_note") ?? "").trim();
    if (!note) {
      fail("Add a short note on how this was resolved before closing it.");
    }
    patch.resolution_note = note;
    patch.resolved_at = new Date().toISOString();
  } else if (target === "open") {
    // Reopen: back to the queue, clear the resolved timestamp. The previous
    // resolution_note stays so the history records how it was first solved.
    patch.resolved_at = null;
  }

  const { data, error } = await svc
    .from("incidents")
    .update(patch)
    .eq("id", incidentId)
    .eq("organisation_id", org.organisation_id)
    .select("id");
  if (isFailedWrite({ error, rows: data })) {
    fail(
      writeErrorMessage(
        { error, rows: data },
        "That incident no longer exists.",
      ),
    );
  }

  revalidatePath(detail);
  revalidatePath(LIST);
  redirect(detail);
}

// ── assignIncident ───────────────────────────────────────────────────────────
// Assign / reassign / unassign. The assignee (when given) must be an active
// manager of the org. "Assign to me" passes the caller's own id.
export async function assignIncident(formData: FormData) {
  const org = await requireManagerOrg();
  const incidentId = String(formData.get("incident_id") ?? "");
  const detail = detailPath(incidentId);
  function fail(message: string): never {
    redirect(`${detail}?error=${encodeURIComponent(message)}`);
  }

  // Empty assignee = unassign (→ null). A non-empty value must validate.
  const submitted = String(formData.get("assigned_to") ?? "").trim();
  let assignee: string | null = null;
  if (submitted) {
    if (!(await managerIsAssignable(org.organisation_id, submitted))) {
      fail("You can only assign an incident to a caretaker or admin.");
    }
    assignee = submitted;
  }

  const svc = createServiceClient();
  const { data, error } = await svc
    .from("incidents")
    .update({ assigned_to: assignee })
    .eq("id", incidentId)
    .eq("organisation_id", org.organisation_id)
    .select("id");
  if (isFailedWrite({ error, rows: data })) {
    fail(
      writeErrorMessage(
        { error, rows: data },
        "That incident no longer exists.",
      ),
    );
  }

  revalidatePath(detail);
  revalidatePath(LIST);
  redirect(detail);
}

// ── addIncidentComment ───────────────────────────────────────────────────────
// Any ACTIVE member (incl. feeders) may add a note. Uses the RLS-bound
// createClient() so the "members insert incident_comments" policy applies (org
// membership only) — NOT the service role. Mirrors submitFeeding's member
// insert. author_id comes from the auth session, never from the form.
export async function addIncidentComment(formData: FormData) {
  const org = await getActiveOrg();
  if (!org) redirect("/app");
  const incidentId = String(formData.get("incident_id") ?? "");
  const detail = detailPath(incidentId);
  function fail(message: string): never {
    redirect(`${detail}?error=${encodeURIComponent(message)}`);
  }

  const body = String(formData.get("body") ?? "").trim();
  if (!body) fail("Write a note before posting.");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Re-validate the incident belongs to the caller's org (RLS already scopes
  // the read, but this turns a foreign/stale id into a clean error rather than
  // an orphaned comment attempt).
  const { data: incident } = await supabase
    .from("incidents")
    .select("id")
    .eq("id", incidentId)
    .eq("organisation_id", org.organisation_id)
    .maybeSingle();
  if (!incident) fail("That incident no longer exists.");

  const { error } = await supabase.from("incident_comments").insert({
    organisation_id: org.organisation_id,
    incident_id: incidentId,
    author_id: user?.id ?? null,
    body,
  });
  if (error) fail(error.message);

  revalidatePath(detail);
  redirect(detail);
}
