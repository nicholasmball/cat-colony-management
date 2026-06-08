// Single source of truth for the incident-lifecycle rules used by the triage
// screens. Pure + dependency-free (no supabase/next imports) so the guard can
// be unit-tested without a live DB — mirrors lib/member-role.ts.
//
// The `transitionIncident` server action loads the few facts this needs (the
// incident's current status + the actor's org role) and defers every decision
// to `canTransitionIncident`. RLS ("managers update incidents",
// 0003_rls:88-90) is the real DB trust boundary; this enforces WHICH edges are
// legal and surfaces a stable, user-facing reason when one isn't.
//
// Lifecycle (design-gate, owner-approved): open → in_progress → resolved, with
// reopen (resolved → open). The DB enum also carries 'closed', but the UI
// collapses resolved + closed into one terminal "Resolved" — 'closed' is never
// surfaced as a transition target here.

// The user-reachable lifecycle states. The DB `incident_status` enum
// (0002_domain.sql:19-20) also has 'closed'; it stays in the data layer but is
// intentionally NOT a transition target in the UI (one terminal "Resolved").
export const INCIDENT_STATUSES = ["open", "in_progress", "resolved"] as const;

export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export function isIncidentStatus(value: unknown): value is IncidentStatus {
  return (
    typeof value === "string" &&
    (INCIDENT_STATUSES as readonly string[]).includes(value)
  );
}

// Only managers (admin/caretaker) may triage. Matches the "managers update
// incidents" RLS policy + requireManagerOrg() in the action.
const MANAGER_ROLES = new Set(["admin", "caretaker"]);

// Allowed directed edges. Keyed `from → set of legal to`.
//   open        → in_progress | resolved
//   in_progress → resolved
//   resolved    → open            (reopen)
const ALLOWED_EDGES: Record<IncidentStatus, ReadonlySet<IncidentStatus>> = {
  open: new Set(["in_progress", "resolved"]),
  in_progress: new Set(["resolved"]),
  resolved: new Set(["open"]),
};

// User-facing reason strings. These feed the `?error=` banner verbatim, so keep
// them stable and human-readable.
export const TRANSITION_REASON = {
  notManager: "Only caretakers and admins can change an incident's status.",
  unknownStatus: "That status isn't a valid step.",
  illegalEdge: "You can't move this incident there.",
} as const;

export type TransitionInput = {
  actorRole: string;
  from: string;
  to: string;
};

// ok:true + noop:true means the request is valid but changes nothing (status
// already at the target) — the action should skip the write and redirect back.
export type TransitionResult =
  | { ok: true; noop: boolean }
  | { ok: false; reason: string };

// Encodes the full lifecycle matrix. Order matters: reject a non-manager and an
// unknown target before treating an identical status as a harmless no-op, so a
// feeder can never probe the edge set via the no-op path.
export function canTransitionIncident({
  actorRole,
  from,
  to,
}: TransitionInput): TransitionResult {
  if (!MANAGER_ROLES.has(actorRole)) {
    return { ok: false, reason: TRANSITION_REASON.notManager };
  }
  if (!isIncidentStatus(to)) {
    return { ok: false, reason: TRANSITION_REASON.unknownStatus };
  }
  // A `from` that isn't a UI state (e.g. the DB's 'closed') can only stay put or
  // be rejected; it has no legal outgoing edge in this lifecycle.
  if (isIncidentStatus(from) && from === to) {
    return { ok: true, noop: true };
  }
  if (isIncidentStatus(from) && ALLOWED_EDGES[from].has(to)) {
    return { ok: true, noop: false };
  }
  return { ok: false, reason: TRANSITION_REASON.illegalEdge };
}
