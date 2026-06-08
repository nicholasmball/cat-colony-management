import { test } from "node:test";
import assert from "node:assert/strict";
import {
  UNCONFIRMED_STATUS,
  hasReportIdentifier,
  parseNeutered,
  canReviewCat,
  canConfirmCat,
  canRejectCat,
  catSortPriority,
  compareCatsForList,
} from "./cat-report.ts";

// ── parseNeutered ──
test("parseNeutered maps 'yes' to true", () => {
  assert.equal(parseNeutered("yes"), true);
});

test("parseNeutered maps 'no' to false", () => {
  assert.equal(parseNeutered("no"), false);
});

test("parseNeutered maps unknown/empty/missing to null", () => {
  assert.equal(parseNeutered(""), null);
  assert.equal(parseNeutered(undefined), null);
  assert.equal(parseNeutered("anything-else"), null);
});

// ── hasReportIdentifier ──
test("hasReportIdentifier accepts a name only", () => {
  assert.equal(hasReportIdentifier({ name: "Smudge", temp_id: null }), true);
});

test("hasReportIdentifier accepts a description only", () => {
  assert.equal(
    hasReportIdentifier({ name: null, temp_id: "black & white by the wall" }),
    true,
  );
});

test("hasReportIdentifier rejects when both are missing", () => {
  assert.equal(hasReportIdentifier({ name: null, temp_id: null }), false);
});

test("hasReportIdentifier rejects whitespace-only inputs", () => {
  assert.equal(hasReportIdentifier({ name: "   ", temp_id: "  " }), false);
});

// ── canReviewCat / canConfirmCat / canRejectCat ──
test("canReviewCat is true only for an unconfirmed, live cat", () => {
  assert.equal(canReviewCat({ status: UNCONFIRMED_STATUS }), true);
});

test("canReviewCat is false for an already-active cat", () => {
  assert.equal(canReviewCat({ status: "active" }), false);
});

test("canReviewCat is false for a soft-deleted unconfirmed cat", () => {
  assert.equal(
    canReviewCat({ status: UNCONFIRMED_STATUS, deleted_at: "2026-06-08T00:00:00Z" }),
    false,
  );
});

test("canConfirmCat and canRejectCat share the review precondition", () => {
  assert.equal(canConfirmCat({ status: UNCONFIRMED_STATUS }), true);
  assert.equal(canRejectCat({ status: "active" }), false);
});

// ── catSortPriority / compareCatsForList ──
test("catSortPriority floats unconfirmed before everything else", () => {
  assert.equal(catSortPriority(UNCONFIRMED_STATUS), 0);
  assert.equal(catSortPriority("active"), 1);
  assert.equal(catSortPriority("missing"), 1);
});

test("compareCatsForList puts unconfirmed first, then alphabetical", () => {
  const cats = [
    { status: "active", name: "Ginger" },
    { status: UNCONFIRMED_STATUS, name: "Smudge" },
    { status: "active", name: "Apricot" },
    { status: UNCONFIRMED_STATUS, name: "Boots" },
  ];
  const sorted = [...cats].sort(compareCatsForList).map((c) => c.name);
  assert.deepEqual(sorted, ["Boots", "Smudge", "Apricot", "Ginger"]);
});

test("compareCatsForList falls back to temp_id and is case-insensitive", () => {
  const cats = [
    { status: "active", name: null, temp_id: "zebra-striped" },
    { status: "active", name: "alpha" },
  ];
  const sorted = [...cats].sort(compareCatsForList).map((c) => c.name ?? c.temp_id);
  assert.deepEqual(sorted, ["alpha", "zebra-striped"]);
});
