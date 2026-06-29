// Server-trusted return-path resolution for inviteVolunteer.
//
// The invite action can be reached from two places: the Members screen (which
// has no `source`, so it defaults back to /app/members) and the Add-schedule
// form (which posts source=schedule + the colony id, so the admin lands back on
// the schedule form). This is deliberately NOT a client-supplied redirect URL —
// we only ever map a known `source` token + a validated colony id onto a path
// we construct ourselves, so a tampered value can never become an open redirect
// (it just falls back to the Members default). Pure + dependency-free so the
// mapping can be unit-tested without a live request.

export const MEMBERS_PATH = "/app/members";

// Colony ids are Postgres uuids; only an exact uuid is allowed to build the
// schedule path. Anything else falls back to the Members default.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type InviteReturnInput = {
  source: string;
  colonyId: string;
};

// Map (source, colonyId) → a trusted in-app path. Unknown source or an invalid
// colony id → the Members default; never an arbitrary/caller-supplied URL.
export function resolveInviteReturn({
  source,
  colonyId,
}: InviteReturnInput): string {
  if (source === "schedule" && UUID_RE.test(colonyId)) {
    return `/app/colonies/${colonyId}/schedules/new`;
  }
  return MEMBERS_PATH;
}

// The full success redirect: the resolved base path plus the invited/sent query
// the destination page reads to show its confirmation. Built with
// URLSearchParams so the encoding matches the existing Members redirect exactly.
export function inviteReturnPath(
  input: InviteReturnInput & { email: string; sent: boolean },
): string {
  const base = resolveInviteReturn(input);
  const query = new URLSearchParams({
    invited: input.email,
    sent: input.sent ? "1" : "0",
  });
  return `${base}?${query.toString()}`;
}
