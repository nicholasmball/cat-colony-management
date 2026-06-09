// Pure channel routing for the alert engine. Maps an alert's severity to the
// set of channels it should fan out to — the "channel intent" the engine RECORDS
// on each notification row (it does NOT send anything; push/SMS/email dispatch
// are separate later cards). Side-effect-free so the mapping is unit-tested in
// isolation and shared by the event hooks and the cron route.
//
// Two tiers, mirroring the org incident-urgency model and the content design
// (docs/alert-engine-content-design.html, step 2):
//   * urgent  → push + sms   (immediate, interrupt-worthy)
//   * routine → in_app + email (digest-friendly, review-when-you-can)

// The four channels from public.notif_channel (0002_domain.sql:21). Kept as a
// string-literal union so callers can't pass an unknown channel.
export type NotifChannel = "in_app" | "email" | "push" | "sms";

export type AlertSeverity = "urgent" | "routine";

// Severity → channel intent. Returns a fresh array each call so callers can
// store it without aliasing a shared constant.
export function channelsFor(severity: AlertSeverity): NotifChannel[] {
  return severity === "urgent" ? ["push", "sms"] : ["in_app", "email"];
}
