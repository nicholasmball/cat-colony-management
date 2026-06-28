// Pure, dependency-free helpers for RESOLVING a feedback row (the admin inbox
// action). Kept free of server-only / Next / Supabase imports so each is
// trivially unit-testable in isolation (mirrors lib/feedback-inbox).
//
//   • validateResolutionNote — trim + bound the optional resolution note.
//   • shouldNotifyReporter    — whether to fire the best-effort reporter notice.
//   • feedbackSnippet         — bound the original message for the notification.

// The hard cap on a resolution note. The textarea enforces it client-side too,
// but the server action is the real guard: a 501+ char note is REJECTED.
export const RESOLUTION_NOTE_MAX = 500;

export type NoteValidation =
  | { ok: true; value: string | null }
  | { ok: false; error: "too_long" };

// Trim the raw note; an empty/whitespace note collapses to null (resolve works
// with no note). A trimmed note over the cap is rejected — the caller maps the
// "too_long" code to a localised message. Non-string input is treated as empty.
export function validateResolutionNote(
  raw: string | null | undefined,
): NoteValidation {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > RESOLUTION_NOTE_MAX)
    return { ok: false, error: "too_long" };
  return { ok: true, value: trimmed };
}

// True only when there is a real, OTHER reporter to notify. No reporter (row
// anonymised / never attributed) → skip. Reporter resolving their own feedback
// → skip (no self-notify, AC13). Pure so both edge cases are unit-tested.
export function shouldNotifyReporter({
  reporterId,
  resolverId,
}: {
  reporterId: string | null | undefined;
  resolverId: string | null | undefined;
}): boolean {
  if (!reporterId) return false;
  if (reporterId === resolverId) return false;
  return true;
}

// The original message, bounded for the notification body so a long report can't
// blow out the in-app row. Collapses internal whitespace runs to single spaces
// (the notification body is one line) and appends an ellipsis when truncated.
export const FEEDBACK_SNIPPET_MAX = 140;

export function feedbackSnippet(
  message: string | null | undefined,
  max = FEEDBACK_SNIPPET_MAX,
): string {
  const flat =
    typeof message === "string" ? message.replace(/\s+/g, " ").trim() : "";
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max).trimEnd()}…`;
}
