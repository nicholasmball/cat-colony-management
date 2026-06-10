// Pure validation for moving a single cat to another colony. Kept dependency-
// free so it's unit-testable without a live DB. The server action does the
// authz + the DB write; this only answers "is this a legal target?" given the
// org's own colonies (already org-scoped + soft-delete-filtered by the caller).

export type MoveCatColony = { id: string };

export type MoveCatCheck =
  | { ok: true }
  | { ok: false; reason: "missing" | "same" | "notFound" };

// targetId must be present, different from the current colony, and one of the
// org's live colonies. `orgColonies` is the caller's already-scoped list (same
// org, not soft-deleted) — so membership in it is the cross-org + existence
// guard.
export function canMoveCat(
  targetId: string | null | undefined,
  currentId: string,
  orgColonies: MoveCatColony[],
): MoveCatCheck {
  const target = (targetId ?? "").trim();
  if (!target) return { ok: false, reason: "missing" };
  if (target === currentId) return { ok: false, reason: "same" };
  if (!orgColonies.some((c) => c.id === target)) {
    return { ok: false, reason: "notFound" };
  }
  return { ok: true };
}
