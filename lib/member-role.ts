// Single source of truth for the role-change rules used by the Members screen.
//
// Pure + dependency-free (no supabase/next imports) so the guards can be
// unit-tested without a live DB. The `updateMemberRole` server action loads the
// few facts this needs (target row + active-admin count) and defers every
// decision to `canChangeRole`. The UI may pre-empt some of these for nicer UX,
// but this is where the rules are actually enforced.

export type AppRole = "admin" | "caretaker" | "feeder";

// Privilege ordering — higher rank = more privilege. A demotion is any move to
// a lower rank.
export const ROLE_RANK: Record<AppRole, number> = {
  admin: 3,
  caretaker: 2,
  feeder: 1,
};

const ROLES = Object.keys(ROLE_RANK) as AppRole[];

export function isRole(value: string): value is AppRole {
  return (ROLES as string[]).includes(value);
}

// Resolve the role for an invite from raw form input. An ABSENT/blank role is
// the server-side default of "feeder" — this is what lets the schedule-form
// invite (which never sends a role) create feeder invites without trusting the
// client. A non-blank but invalid value (e.g. "owner") is rejected as null so
// the action can surface roleRequired and write no invitation row. A valid role
// (the Members form's feeder/caretaker/admin) is returned unchanged, so the
// existing Members behaviour is preserved exactly.
export function inviteRoleFromInput(raw: string): AppRole | null {
  const trimmed = raw.trim();
  if (trimmed === "") return "feeder";
  return isRole(trimmed) ? trimmed : null;
}

// True when moving from currentRole to newRole drops privilege
// (e.g. admin→caretaker, caretaker→feeder).
export function isDemotion(currentRole: AppRole, newRole: AppRole): boolean {
  return ROLE_RANK[newRole] < ROLE_RANK[currentRole];
}

// User-facing reason strings. These feed the `?error=` banner verbatim, so keep
// them stable and human-readable.
export const ROLE_REASON = {
  invalidRole: "Invalid role.",
  selfChange: "You can’t change your own role.",
  inactive: "That member is deactivated.",
  lastAdmin: "You can’t change the role of the last admin.",
} as const;

export type RoleChangeTarget = {
  userId: string;
  currentRole: AppRole;
  isActive: boolean;
};

export type RoleChangeInput = {
  actorUserId: string;
  target: RoleChangeTarget;
  newRole: string;
  // Number of active admins in the org (used for the last-admin guard).
  activeAdminCount: number;
};

// ok:true + noop:true means the request is valid but changes nothing — the
// action should skip the write and redirect back without an error.
export type RoleChangeResult =
  | { ok: true; noop: boolean }
  | { ok: false; reason: string };

// Encodes every Step-1 guardrail. Order matters: reject malformed/forbidden
// input before treating an identical role as a harmless no-op.
export function canChangeRole({
  actorUserId,
  target,
  newRole,
  activeAdminCount,
}: RoleChangeInput): RoleChangeResult {
  if (!isRole(newRole)) {
    return { ok: false, reason: ROLE_REASON.invalidRole };
  }
  if (actorUserId === target.userId) {
    return { ok: false, reason: ROLE_REASON.selfChange };
  }
  if (!target.isActive) {
    return { ok: false, reason: ROLE_REASON.inactive };
  }
  // Demoting the sole remaining admin would leave the org with no admin.
  if (
    target.currentRole === "admin" &&
    newRole !== "admin" &&
    activeAdminCount <= 1
  ) {
    return { ok: false, reason: ROLE_REASON.lastAdmin };
  }
  if (newRole === target.currentRole) {
    return { ok: true, noop: true };
  }
  return { ok: true, noop: false };
}
