import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateResolutionNote,
  shouldNotifyReporter,
  feedbackSnippet,
  RESOLUTION_NOTE_MAX,
} from "./feedback-resolve.ts";

// ── validateResolutionNote ───────────────────────────────────────────────────
test("validateResolutionNote trims and keeps a normal note", () => {
  assert.deepEqual(validateResolutionNote("  Fixed in v0.9.5  "), {
    ok: true,
    value: "Fixed in v0.9.5",
  });
});

test("validateResolutionNote collapses empty/whitespace/absent to null", () => {
  assert.deepEqual(validateResolutionNote(""), { ok: true, value: null });
  assert.deepEqual(validateResolutionNote("   "), { ok: true, value: null });
  assert.deepEqual(validateResolutionNote(null), { ok: true, value: null });
  assert.deepEqual(validateResolutionNote(undefined), {
    ok: true,
    value: null,
  });
});

test("validateResolutionNote accepts exactly the cap and rejects one over", () => {
  const atCap = "x".repeat(RESOLUTION_NOTE_MAX);
  assert.deepEqual(validateResolutionNote(atCap), { ok: true, value: atCap });
  const over = "x".repeat(RESOLUTION_NOTE_MAX + 1);
  assert.deepEqual(validateResolutionNote(over), {
    ok: false,
    error: "too_long",
  });
});

test("validateResolutionNote measures the TRIMMED length (trailing space doesn't push over)", () => {
  const padded = `${"x".repeat(RESOLUTION_NOTE_MAX)}    `;
  assert.equal(validateResolutionNote(padded).ok, true);
});

// ── shouldNotifyReporter ─────────────────────────────────────────────────────
test("shouldNotifyReporter is true for a distinct reporter", () => {
  assert.equal(
    shouldNotifyReporter({ reporterId: "rep", resolverId: "admin" }),
    true,
  );
});

test("shouldNotifyReporter is false when there is no reporter", () => {
  assert.equal(
    shouldNotifyReporter({ reporterId: null, resolverId: "admin" }),
    false,
  );
  assert.equal(
    shouldNotifyReporter({ reporterId: undefined, resolverId: "admin" }),
    false,
  );
});

test("shouldNotifyReporter is false when the reporter resolves their own row (no self-notify)", () => {
  assert.equal(
    shouldNotifyReporter({ reporterId: "same", resolverId: "same" }),
    false,
  );
});

// ── feedbackSnippet ──────────────────────────────────────────────────────────
test("feedbackSnippet returns a short message unchanged (whitespace flattened)", () => {
  assert.equal(feedbackSnippet("A short report"), "A short report");
  assert.equal(feedbackSnippet("line one\n\nline  two"), "line one line two");
});

test("feedbackSnippet truncates a long message with an ellipsis", () => {
  const long = "x".repeat(200);
  const out = feedbackSnippet(long, 140);
  assert.equal(out.length, 141); // 140 chars + the ellipsis glyph
  assert.ok(out.endsWith("…"));
});

test("feedbackSnippet handles empty/absent input", () => {
  assert.equal(feedbackSnippet(""), "");
  assert.equal(feedbackSnippet(null), "");
  assert.equal(feedbackSnippet(undefined), "");
});
