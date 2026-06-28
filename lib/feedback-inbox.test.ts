import { test } from "node:test";
import assert from "node:assert/strict";
import {
  feedbackStatusBadge,
  shortAppVersion,
  isInAppPath,
} from "./feedback-inbox.ts";

// ── feedbackStatusBadge ──────────────────────────────────────────────────────
test("feedbackStatusBadge maps the known statuses to their own variant", () => {
  assert.deepEqual(feedbackStatusBadge("new"), { variant: "new", label: null });
  assert.deepEqual(feedbackStatusBadge("queued"), {
    variant: "queued",
    label: null,
  });
});

test("feedbackStatusBadge falls back to a neutral badge for unmapped values", () => {
  // A future bot status must still render safely (neutral + raw label).
  assert.deepEqual(feedbackStatusBadge("triaged"), {
    variant: "neutral",
    label: "triaged",
  });
  assert.deepEqual(feedbackStatusBadge("DONE"), {
    variant: "neutral",
    label: "DONE",
  });
});

test("feedbackStatusBadge never renders bare for empty/null/whitespace", () => {
  assert.deepEqual(feedbackStatusBadge(""), { variant: "neutral", label: "—" });
  assert.deepEqual(feedbackStatusBadge("   "), {
    variant: "neutral",
    label: "—",
  });
  assert.deepEqual(feedbackStatusBadge(null), {
    variant: "neutral",
    label: "—",
  });
  assert.deepEqual(feedbackStatusBadge(undefined), {
    variant: "neutral",
    label: "—",
  });
});

// ── shortAppVersion ──────────────────────────────────────────────────────────
test("shortAppVersion truncates a long commit SHA to 7 chars", () => {
  assert.equal(
    shortAppVersion("a1f9c20e3b4d5f6a7b8c9d0e1f2a3b4c5d6e7f80"),
    "a1f9c20",
  );
  assert.equal(shortAppVersion("ABCDEF1234"), "ABCDEF1"); // case-insensitive hex
});

test("shortAppVersion leaves short / non-SHA labels unchanged", () => {
  assert.equal(shortAppVersion("dev"), "dev");
  assert.equal(shortAppVersion("v0.9.4"), "v0.9.4"); // has non-hex chars
  assert.equal(shortAppVersion("abc1234"), "abc1234"); // exactly 7, < 8 → as-is
});

test("shortAppVersion returns null for empty/absent so the chip can be omitted", () => {
  assert.equal(shortAppVersion(null), null);
  assert.equal(shortAppVersion(undefined), null);
  assert.equal(shortAppVersion(""), null);
  assert.equal(shortAppVersion("   "), null);
});

// ── isInAppPath ──────────────────────────────────────────────────────────────
test("isInAppPath accepts in-app routes", () => {
  assert.equal(isInAppPath("/app/today"), true);
  assert.equal(isInAppPath("/app/colonies/largo/schedules"), true);
});

test("isInAppPath rejects external / unsafe / absent values", () => {
  assert.equal(
    isInAppPath("https://app.streetcatsoftavira.org/app/today"),
    false,
  );
  assert.equal(isInAppPath("//app.evil.com"), false); // protocol-relative
  assert.equal(isInAppPath("/login"), false);
  assert.equal(isInAppPath(null), false);
  assert.equal(isInAppPath(undefined), false);
  assert.equal(isInAppPath(""), false);
});
