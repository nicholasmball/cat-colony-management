// Shared guard for soft-delete / destructive writes done through the
// service-role client (RLS bypassed) but scoped explicitly in app code.
//
// Why this exists: a write that returns `{ error: null }` but touches 0 rows is
// a SILENT no-op. PostgREST does not raise an error when an UPDATE matches no
// rows — so an action that only checks `error` redirects with a clean success
// while nothing changed (the original deleteSchedule bug). Because we now
// always chain `.select()`, we can see the affected rows and treat 0 as a
// failure. Pure + dependency-free so it's unit-testable without a live DB.

export type WriteOutcome = {
  // PostgREST error, if any (DB constraint, RLS, network, etc.).
  error: { message: string } | null;
  // Rows returned by the chained `.select()`. Null when the select itself
  // failed or returned nothing.
  rows: unknown[] | null;
};

// True when the write must be surfaced to the user as a failure: either the DB
// reported an error, or it succeeded but affected no rows (the silent-no-op).
export function isFailedWrite({ error, rows }: WriteOutcome): boolean {
  return error !== null || (rows?.length ?? 0) === 0;
}

// Human-readable reason for a failed write, suitable for an `?error=` redirect.
// Distinguishes a real DB error from the "matched nothing" case so the latter
// can never again look like success.
export function writeErrorMessage(
  { error, rows }: WriteOutcome,
  notFoundMessage: string,
): string {
  if (error) return error.message;
  if ((rows?.length ?? 0) === 0) return notFoundMessage;
  return "";
}
