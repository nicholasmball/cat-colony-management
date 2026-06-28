// Pure, dependency-free helpers for the admin Feedback Inbox (read view).
// Kept free of server-only / Next / Supabase imports so each is trivially
// unit-testable in isolation (mirrors lib/feedback, lib/app-version).
//
// These cover the three presentation decisions the inbox page must make safely:
//   • feedbackStatusBadge — map a row's `status` to a badge variant, tolerating
//     ANY unmapped value (the bot may introduce new statuses without a deploy).
//   • shortAppVersion     — shorten a long commit SHA to its 7-char prefix.
//   • isInAppPath         — classify a stored page_url as a safe in-app route
//     (renderable as a <Link>) vs. anything else (rendered as plain text).

// The statuses the inbox renders with a dedicated, coloured badge. Everything
// else (a future bot status like "triaged" / "done") falls back to a neutral
// badge that still shows the raw value — never a crash, never a bare render.
// 'resolved' is the terminal admin-set state (0012) — a slate badge, no actions.
export const KNOWN_FEEDBACK_STATUSES = ["new", "queued", "resolved"] as const;
export type KnownFeedbackStatus = (typeof KNOWN_FEEDBACK_STATUSES)[number];

export type FeedbackStatusBadge =
  // A known status: `variant` doubles as the i18n leaf (feedback.inbox.status.*)
  // and the visual variant; `label` is null because the page localises by key.
  | { variant: KnownFeedbackStatus; label: null }
  // An unmapped status: neutral variant, render the raw value verbatim.
  | { variant: "neutral"; label: string };

export function feedbackStatusBadge(
  status: string | null | undefined,
): FeedbackStatusBadge {
  const raw = (status ?? "").trim();
  if ((KNOWN_FEEDBACK_STATUSES as readonly string[]).includes(raw)) {
    return { variant: raw as KnownFeedbackStatus, label: null };
  }
  // Unknown/empty → neutral badge. Empty collapses to a dash so it never renders
  // bare. The DB column is NOT NULL default 'new', so empty is purely defensive.
  return { variant: "neutral", label: raw.length > 0 ? raw : "—" };
}

// Shorten a commit-SHA app_version to its 7-char prefix (git convention). A
// non-SHA value (e.g. the local "dev" sentinel) is returned unchanged; an
// empty/absent value yields null so the caller can omit the chip entirely.
export function shortAppVersion(
  version: string | null | undefined,
): string | null {
  if (!version) return null;
  const v = version.trim();
  if (!v) return null;
  // A long hex string is a commit SHA → show the short prefix. Anything else
  // (already short, or a human label like "dev") is shown as-is.
  if (/^[0-9a-f]{8,}$/i.test(v)) return v.slice(0, 7);
  return v;
}

// True only for a stored page_url that is a safe in-app route ("/app/today").
// Occasionally page_url is a full referrer URL ("https://…") — those are NOT
// in-app and must be rendered as plain text, never auto-opened or trusted as a
// link. Protocol-relative URLs ("//evil.com") start with "//", not "/app", so
// they're correctly classified as non-in-app.
export function isInAppPath(pageUrl: string | null | undefined): boolean {
  return typeof pageUrl === "string" && pageUrl.startsWith("/app");
}
