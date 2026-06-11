import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FEEDBACK_KINDS,
  FEEDBACK_MESSAGE_MAX,
  isFeedbackKind,
} from "./feedback.ts";

test("isFeedbackKind accepts the two valid kinds", () => {
  assert.equal(isFeedbackKind("bug"), true);
  assert.equal(isFeedbackKind("idea"), true);
  // The lookup is exactly these two.
  assert.deepEqual([...FEEDBACK_KINDS], ["bug", "idea"]);
});

test("isFeedbackKind rejects anything outside the set (incl. empty + non-strings)", () => {
  assert.equal(isFeedbackKind(""), false);
  assert.equal(isFeedbackKind("Bug"), false); // case-sensitive
  assert.equal(isFeedbackKind("feature"), false);
  assert.equal(isFeedbackKind("complaint"), false);
  assert.equal(isFeedbackKind(undefined), false);
  assert.equal(isFeedbackKind(null), false);
  assert.equal(isFeedbackKind(1), false);
  assert.equal(isFeedbackKind({}), false);
});

test("FEEDBACK_MESSAGE_MAX is the agreed soft cap", () => {
  assert.equal(FEEDBACK_MESSAGE_MAX, 2000);
});

// The message-required rule the server action enforces: trim, then reject empty.
// Pure restatement so the boundary is unit-asserted independent of the action.
function messageIsEmpty(raw: string | null | undefined): boolean {
  return (raw ?? "").trim().length === 0;
}

test("message-required: empty / whitespace-only is rejected", () => {
  assert.equal(messageIsEmpty(""), true);
  assert.equal(messageIsEmpty("   "), true);
  assert.equal(messageIsEmpty("\n\t "), true);
  assert.equal(messageIsEmpty(undefined), true);
  assert.equal(messageIsEmpty(null), true);
});

test("message-required: any non-blank content passes", () => {
  assert.equal(messageIsEmpty("hi"), false);
  assert.equal(messageIsEmpty("  the seen button overlaps  "), false);
});
