// Pure presentation helpers for the in-app notification centre. React/Next-free
// so they're trivially unit-testable and shared between the nav badge and the
// page's row rendering.

// The nav unread badge text. Hidden at 0 (returns null — the component renders
// nothing), the exact count up to 9, and a capped "9+" beyond. Negative/NaN are
// treated as 0 defensively (a bad count must never render a stray badge).
export function unreadBadge(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  if (count > 9) return "9+";
  return String(Math.floor(count));
}

// A notification row's two render-time choices (title key + optional body key)
// derived purely from its stored type + params. Kept pure so the (fiddly)
// not_seen body-variant selection + the "is this a known type" decision are
// tested without a live DB or next-intl.
//
// `bodyKey` is the FULL message key to translate for the body; for the nested
// not_seen alert it resolves to the right sub-key from the row's `reason`
// param, falling back to not_seen_days when the reason is missing/unknown so a
// malformed row still renders a sensible body rather than a raw placeholder.
export type NotificationKeys = {
  titleKey: string;
  bodyKey: string;
};

const NOT_SEEN_BODY: Record<string, string> = {
  not_seen_days: "alerts.not_seen.body.not_seen_days",
  repeated_not_seen: "alerts.not_seen.body.repeated_not_seen",
};

export function notificationKeys(
  type: string,
  params: Record<string, unknown>,
): NotificationKeys {
  if (type === "not_seen") {
    const reason = typeof params.reason === "string" ? params.reason : "";
    return {
      titleKey: "alerts.not_seen.title",
      bodyKey: NOT_SEEN_BODY[reason] ?? NOT_SEEN_BODY.not_seen_days,
    };
  }
  if (type === "feedback_resolved") {
    // The reporter's "your feedback was resolved" notice. Two body variants: with
    // the admin's optional note quoted, or — when the note is empty — just the
    // original-message snippet. Mirrors the not_seen param-driven body choice.
    const hasNote =
      typeof params.note === "string" && params.note.trim().length > 0;
    return {
      titleKey: "alerts.feedback_resolved.title",
      bodyKey: hasNote
        ? "alerts.feedback_resolved.body.with_note"
        : "alerts.feedback_resolved.body.without_note",
    };
  }
  // Every other alert is a flat { title, body } pair under alerts.<type>.
  return {
    titleKey: `alerts.${type}.title`,
    bodyKey: `alerts.${type}.body`,
  };
}
