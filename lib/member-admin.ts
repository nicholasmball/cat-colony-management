// Single source of truth for the "permanently erase a member" decision used by
// the Members screen — the destructive, irreversible GDPR right-to-be-forgotten
// action (deletes the auth account), distinct from the reversible deactivate.
//
// Pure + dependency-free (no supabase/next imports) so the guards can be
// unit-tested without a live DB — mirrors lib/member-role's canChangeRole. The
// `eraseMember` server action loads the few facts this needs (does the target
// belong to THIS org, their role, the org's active-admin count) and defers the
// authorisation decision here. The UI may pre-empt some of these for nicer UX,
// but this is where the rails are actually enforced.

import { type AppRole } from "./member-role.ts";

// User-facing reason strings. These feed the `?error=` banner verbatim (the
// action passes the localized message through), so the keys map 1:1 to the
// `errors` i18n namespace. Kept as a stable contract for the unit matrix.
export type EraseDenyReason =
  | "cannotEraseSelf"
  | "cannotEraseLastAdmin"
  | "memberNoLongerExists";

export type EraseMemberInput = {
  // Who is initiating the erase (the acting admin).
  actingUserId: string;
  // Who they're trying to erase.
  targetUserId: string;
  // The target's role in THIS org (only meaningful when targetInOrg is true).
  targetRole: AppRole;
  // Number of active admins in THIS org (drives the last-admin guard).
  adminCount: number;
  // Does the target currently belong to THIS org? The org-membership check is
  // the authorisation gate: an admin may only initiate erasure for someone in
  // their own org (even though the erase itself is global — see eraseMember).
  targetInOrg: boolean;
};

export type EraseMemberResult =
  | { ok: true }
  | { ok: false; reason: EraseDenyReason };

// Encodes every rail for erasing a member. Order matters: the org-membership
// gate comes first (you can't act on someone who isn't in your org), then
// never-self, then never-the-last-admin (erasing the sole admin would orphan
// the org).
export function canEraseMember({
  actingUserId,
  targetUserId,
  targetRole,
  adminCount,
  targetInOrg,
}: EraseMemberInput): EraseMemberResult {
  if (!targetInOrg) {
    return { ok: false, reason: "memberNoLongerExists" };
  }
  if (actingUserId === targetUserId) {
    return { ok: false, reason: "cannotEraseSelf" };
  }
  if (targetRole === "admin" && adminCount <= 1) {
    return { ok: false, reason: "cannotEraseLastAdmin" };
  }
  return { ok: true };
}
