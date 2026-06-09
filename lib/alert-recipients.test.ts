import { test } from "node:test";
import assert from "node:assert/strict";
import { alertRecipients } from "./alert-recipients.ts";

test("includes admins and caretakers, excludes feeders", () => {
  const ids = alertRecipients([
    { user_id: "a", role: "admin" },
    { user_id: "c", role: "caretaker" },
    { user_id: "f", role: "feeder" },
  ]);
  assert.deepEqual(ids.sort(), ["a", "c"]);
});

test("excludes deactivated (soft-deleted) memberships", () => {
  const ids = alertRecipients([
    { user_id: "a", role: "admin", deleted_at: null },
    { user_id: "c", role: "caretaker", deleted_at: "2026-01-01T00:00:00Z" },
  ]);
  assert.deepEqual(ids, ["a"]);
});

test("deduplicates a user appearing twice", () => {
  const ids = alertRecipients([
    { user_id: "a", role: "admin" },
    { user_id: "a", role: "caretaker" },
  ]);
  assert.deepEqual(ids, ["a"]);
});

test("empty membership list → no recipients", () => {
  assert.deepEqual(alertRecipients([]), []);
});
