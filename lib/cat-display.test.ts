import { test } from "node:test";
import assert from "node:assert/strict";
import {
  catLabel,
  formatStatus,
  statusTone,
  catSubtitle,
} from "./cat-display.ts";

test("catLabel prefers name", () => {
  assert.equal(catLabel({ name: "Mochi", temp_id: "ginger tom" }), "Mochi");
});

test("catLabel falls back to temp_id when no name", () => {
  assert.equal(
    catLabel({ name: null, temp_id: "ginger tom by the bins" }),
    "ginger tom by the bins",
  );
});

test("catLabel trims whitespace-only name before falling back", () => {
  assert.equal(catLabel({ name: "   ", temp_id: "Pip" }), "Pip");
});

test("catLabel handles a cat with no identifiers", () => {
  assert.equal(catLabel({ name: null, temp_id: null }), "Unnamed cat");
});

test("formatStatus replaces underscores", () => {
  assert.equal(formatStatus("not_seen"), "not seen");
  assert.equal(formatStatus("active"), "active");
});

test("formatStatus uses a friendly label for new_unconfirmed", () => {
  assert.equal(formatStatus("new_unconfirmed"), "New · unconfirmed");
});

test("statusTone keeps new_unconfirmed in the neutral tone", () => {
  assert.equal(statusTone("new_unconfirmed"), "neutral");
});

test("statusTone maps known statuses", () => {
  assert.equal(statusTone("active"), "good");
  assert.equal(statusTone("seen"), "good");
  assert.equal(statusTone("concern"), "warn");
  assert.equal(statusTone("missing"), "bad");
  assert.equal(statusTone("not_seen"), "bad");
});

test("statusTone is neutral for unknown statuses", () => {
  assert.equal(statusTone("rehomed"), "neutral");
  assert.equal(statusTone(""), "neutral");
});

test("catSubtitle joins colour and status", () => {
  assert.equal(
    catSubtitle({ colour: "ginger", status: "not_seen" }),
    "ginger · not seen",
  );
});

test("catSubtitle drops missing parts without stray separators", () => {
  assert.equal(catSubtitle({ colour: null, status: "active" }), "active");
  assert.equal(catSubtitle({ colour: "black", status: null }), "black");
  assert.equal(catSubtitle({ colour: null, status: null }), "");
});
