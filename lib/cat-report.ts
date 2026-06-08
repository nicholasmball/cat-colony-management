// Pure, dependency-free helpers for the "Report a new cat" flow and the
// caretaker confirm/reject review surface. Kept free of React/Supabase/Next so
// the rules are trivially unit-testable and shared between the report form, the
// server actions and the colony/cat pages.

// The status a freshly reported cat lands in (RLS lets a feeder INSERT only
// while status = this value). Centralised so the form, action and guards agree.
export const UNCONFIRMED_STATUS = "new_unconfirmed";

// A report needs at least ONE identifier — a name OR a description (temp_id) —
// mirroring the cats_need_identifier CHECK. Everything else is optional and
// must never block the report. Whitespace-only is treated as empty.
export function hasReportIdentifier(input: {
  name?: string | null;
  temp_id?: string | null;
}): boolean {
  return Boolean(input.name?.trim() || input.temp_id?.trim());
}

// Confirm/Reject may only fire while the cat is still awaiting review. This is
// the single rule both the UI gate and the server actions defer to, so Confirm
// can never re-fire on an already-active cat (and Reject can't double-delete).
export function canReviewCat(cat: { status: string; deleted_at?: string | null }): boolean {
  return cat.status === UNCONFIRMED_STATUS && !cat.deleted_at;
}

// Confirm and Reject share the exact same precondition today — both only act on
// a still-unconfirmed, not-yet-deleted cat. Named separately so call sites read
// clearly and so the rules can diverge later without touching callers.
export const canConfirmCat = canReviewCat;
export const canRejectCat = canReviewCat;

// Sort priority for the colony cats list: unconfirmed cats float to the top so
// review work is visible at a glance (design §3.1). Lower number = earlier.
// Derived ordering only — nothing is stored.
export function catSortPriority(status: string): number {
  return status === UNCONFIRMED_STATUS ? 0 : 1;
}

// O(n log n) comparator: unconfirmed first, then by display label (name or
// description) case-insensitively. A pure comparator so the page can sort the
// already-fetched rows without a second query or any stored ordering.
export function compareCatsForList(
  a: { status: string; name?: string | null; temp_id?: string | null },
  b: { status: string; name?: string | null; temp_id?: string | null },
): number {
  const byStatus = catSortPriority(a.status) - catSortPriority(b.status);
  if (byStatus !== 0) return byStatus;
  const al = (a.name?.trim() || a.temp_id?.trim() || "").toLowerCase();
  const bl = (b.name?.trim() || b.temp_id?.trim() || "").toLowerCase();
  return al.localeCompare(bl);
}
