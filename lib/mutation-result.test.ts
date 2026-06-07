import { test } from "node:test";
import assert from "node:assert/strict";
import { isFailedWrite, writeErrorMessage } from "./mutation-result.ts";

// The three equivalence classes a Supabase write+select can land in.

test("isFailedWrite: DB error → failure", () => {
  assert.equal(
    isFailedWrite({ error: { message: "permission denied" }, rows: null }),
    true,
  );
  // Even if some rows came back, a non-null error is still a failure.
  assert.equal(
    isFailedWrite({ error: { message: "boom" }, rows: [{ id: "1" }] }),
    true,
  );
});

test("isFailedWrite: no error but 0 rows → failure (the silent no-op bug)", () => {
  assert.equal(isFailedWrite({ error: null, rows: [] }), true);
  // A null select payload is treated the same as zero rows.
  assert.equal(isFailedWrite({ error: null, rows: null }), true);
});

test("isFailedWrite: no error and ≥1 row → success", () => {
  assert.equal(isFailedWrite({ error: null, rows: [{ id: "1" }] }), false);
  assert.equal(
    isFailedWrite({ error: null, rows: [{ id: "1" }, { id: "2" }] }),
    false,
  );
});

test("writeErrorMessage: prefers the DB error message", () => {
  assert.equal(
    writeErrorMessage(
      { error: { message: "constraint violated" }, rows: null },
      "Not found.",
    ),
    "constraint violated",
  );
});

test("writeErrorMessage: 0 rows → the not-found message", () => {
  assert.equal(
    writeErrorMessage({ error: null, rows: [] }, "Schedule not found."),
    "Schedule not found.",
  );
});

test("writeErrorMessage: success → empty string", () => {
  assert.equal(
    writeErrorMessage({ error: null, rows: [{ id: "1" }] }, "Not found."),
    "",
  );
});
