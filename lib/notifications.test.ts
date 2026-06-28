import { test } from "node:test";
import assert from "node:assert/strict";
import { unreadBadge, notificationKeys } from "./notifications.ts";

// ── unreadBadge ──────────────────────────────────────────────────────────────
test("unreadBadge hides at zero (and below)", () => {
  assert.equal(unreadBadge(0), null);
  assert.equal(unreadBadge(-3), null);
});

test("unreadBadge shows the exact count 1..9", () => {
  assert.equal(unreadBadge(1), "1");
  assert.equal(unreadBadge(9), "9");
});

test("unreadBadge caps at 9+", () => {
  assert.equal(unreadBadge(10), "9+");
  assert.equal(unreadBadge(250), "9+");
});

test("unreadBadge is defensive about non-finite input (treated as no badge)", () => {
  assert.equal(unreadBadge(Number.NaN), null);
  assert.equal(unreadBadge(Number.POSITIVE_INFINITY), null);
});

// ── notificationKeys ─────────────────────────────────────────────────────────
test("flat alert types map to alerts.<type>.title/.body", () => {
  assert.deepEqual(notificationKeys("incident_urgent", {}), {
    titleKey: "alerts.incident_urgent.title",
    bodyKey: "alerts.incident_urgent.body",
  });
  assert.deepEqual(notificationKeys("feeding_missed", {}), {
    titleKey: "alerts.feeding_missed.title",
    bodyKey: "alerts.feeding_missed.body",
  });
});

test("not_seen resolves the body sub-key from the reason param", () => {
  assert.deepEqual(notificationKeys("not_seen", { reason: "not_seen_days" }), {
    titleKey: "alerts.not_seen.title",
    bodyKey: "alerts.not_seen.body.not_seen_days",
  });
  assert.deepEqual(
    notificationKeys("not_seen", { reason: "repeated_not_seen" }),
    {
      titleKey: "alerts.not_seen.title",
      bodyKey: "alerts.not_seen.body.repeated_not_seen",
    },
  );
});

test("not_seen falls back to not_seen_days when reason is missing/unknown", () => {
  assert.equal(
    notificationKeys("not_seen", {}).bodyKey,
    "alerts.not_seen.body.not_seen_days",
  );
  assert.equal(
    notificationKeys("not_seen", { reason: "bogus" }).bodyKey,
    "alerts.not_seen.body.not_seen_days",
  );
});

test("feedback_resolved picks the with_note body only when a non-empty note is present", () => {
  assert.deepEqual(
    notificationKeys("feedback_resolved", { note: "Shipped in v0.9.5" }),
    {
      titleKey: "alerts.feedback_resolved.title",
      bodyKey: "alerts.feedback_resolved.body.with_note",
    },
  );
  // No note / blank note / absent param → the without_note body (snippet only).
  assert.equal(
    notificationKeys("feedback_resolved", {}).bodyKey,
    "alerts.feedback_resolved.body.without_note",
  );
  assert.equal(
    notificationKeys("feedback_resolved", { note: "   " }).bodyKey,
    "alerts.feedback_resolved.body.without_note",
  );
});
