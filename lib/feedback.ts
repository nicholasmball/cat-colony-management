// Pure, dependency-free feedback domain helpers. The feedback `kind` is a small
// closed lookup (bug | idea) modelled as a per-row text + check constraint in the
// DB (0011_feedback.sql); this is the single TypeScript-side guard that the
// server action uses to reject anything outside the set before a row is written.
// Kept free of server-only/Next/Supabase imports so it's trivially unit-testable.

export const FEEDBACK_KINDS = ["bug", "idea"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

// Soft cap on the message length, mirrored by the form's live counter. Advisory
// (the "never block on a field" ethos) — the server only rejects empty.
export const FEEDBACK_MESSAGE_MAX = 2000;

export function isFeedbackKind(value: unknown): value is FeedbackKind {
  return (
    typeof value === "string" &&
    (FEEDBACK_KINDS as readonly string[]).includes(value)
  );
}
