import { test } from "node:test";
import assert from "node:assert/strict";
import { selectDigests, type DigestRow } from "./digest.ts";

function row(over: Partial<DigestRow>): DigestRow {
  return {
    id: "n1",
    recipient_id: "u1",
    organisation_id: "o1",
    type: "feeding_missed",
    message_params: {},
    channels: ["in_app", "email"],
    dispatched_at: null,
    ...over,
  };
}

test("empty input → empty map", () => {
  assert.equal(selectDigests([]).size, 0);
});

test("includes only undispatched email-channel rows", () => {
  const rows = [
    row({ id: "a" }),
    row({ id: "b", dispatched_at: "2026-06-01T00:00:00Z" }), // already sent
    row({ id: "c", channels: ["push", "sms"] }), // urgent, not email
    row({ id: "d", channels: null }), // no channel info
  ];
  const out = selectDigests(rows);
  assert.equal(out.size, 1);
  const payload = out.get("u1:o1");
  assert.deepEqual(payload?.rowIds, ["a"]);
});

test("one payload per recipient, grouping their rows", () => {
  const rows = [
    row({ id: "a", recipient_id: "u1" }),
    row({ id: "b", recipient_id: "u1" }),
    row({ id: "c", recipient_id: "u2" }),
  ];
  const out = selectDigests(rows);
  assert.equal(out.size, 2);
  assert.deepEqual(out.get("u1:o1")?.rowIds, ["a", "b"]);
  assert.deepEqual(out.get("u2:o1")?.rowIds, ["c"]);
});

test("same recipient in two orgs → one payload per org", () => {
  const rows = [
    row({ id: "a", recipient_id: "u1", organisation_id: "o1" }),
    row({ id: "b", recipient_id: "u1", organisation_id: "o2" }),
  ];
  const out = selectDigests(rows);
  assert.equal(out.size, 2);
  assert.deepEqual(out.get("u1:o1")?.rowIds, ["a"]);
  assert.deepEqual(out.get("u1:o2")?.rowIds, ["b"]);
});

test("dedups a repeated row id within the input", () => {
  const rows = [row({ id: "a" }), row({ id: "a" })];
  const out = selectDigests(rows);
  assert.deepEqual(out.get("u1:o1")?.rowIds, ["a"]);
});

test("carries type + params through for rendering", () => {
  const rows = [
    row({ id: "a", type: "not_seen", message_params: { catName: "Tom" } }),
  ];
  const item = selectDigests(rows).get("u1:o1")?.items[0];
  assert.equal(item?.type, "not_seen");
  assert.deepEqual(item?.message_params, { catName: "Tom" });
});
