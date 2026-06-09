import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseFeedingInput,
  isSightingStatus,
  SIGHTING_STATUSES,
} from "./feeding-input.ts";

const ID = "11111111-1111-4111-8111-111111111111";
const COLONY = "22222222-2222-4222-8222-222222222222";
const CAT = "33333333-3333-4333-8333-333333333333";
const SIGHTING = "44444444-4444-4444-8444-444444444444";

test("isSightingStatus: the three form statuses pass, others fail", () => {
  for (const s of SIGHTING_STATUSES) assert.equal(isSightingStatus(s), true);
  assert.equal(isSightingStatus("fed"), false);
  assert.equal(isSightingStatus(""), false);
  assert.equal(isSightingStatus(undefined), false);
});

test("parseFeedingInput: valid body with no sightings", () => {
  const r = parseFeedingInput({ id: ID, colonyId: COLONY, fed: true });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.id, ID);
  assert.equal(r.value.colonyId, COLONY);
  assert.equal(r.value.fed, true);
  assert.equal(r.value.problem, false);
  assert.equal(r.value.notes, null);
  assert.deepEqual(r.value.sightings, []);
});

test("parseFeedingInput: valid body with a sighting + flags + notes", () => {
  const r = parseFeedingInput({
    id: ID,
    colonyId: COLONY,
    fed: false,
    problem: true,
    foodIssue: true,
    danger: true,
    notes: "  spilled food  ",
    sightings: [{ id: SIGHTING, catId: CAT, status: "concern" }],
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.fed, false);
  assert.equal(r.value.problem, true);
  assert.equal(r.value.foodIssue, true);
  assert.equal(r.value.danger, true);
  assert.equal(r.value.notes, "spilled food"); // trimmed
  assert.deepEqual(r.value.sightings, [
    { id: SIGHTING, catId: CAT, status: "concern" },
  ]);
});

test("parseFeedingInput: legacy '1'/'0' string flags still coerce", () => {
  const r = parseFeedingInput({
    id: ID,
    colonyId: COLONY,
    fed: "1",
    problem: "0",
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.fed, true);
  assert.equal(r.value.problem, false);
});

test("parseFeedingInput: blank/whitespace notes normalise to null", () => {
  const r = parseFeedingInput({ id: ID, colonyId: COLONY, notes: "   " });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.notes, null);
});

test("parseFeedingInput: missing/invalid feeding id is rejected", () => {
  assert.equal(parseFeedingInput({ colonyId: COLONY }).ok, false);
  assert.equal(parseFeedingInput({ id: "nope", colonyId: COLONY }).ok, false);
});

test("parseFeedingInput: missing/invalid colony id is rejected", () => {
  assert.equal(parseFeedingInput({ id: ID }).ok, false);
  assert.equal(parseFeedingInput({ id: ID, colonyId: "nope" }).ok, false);
});

test("parseFeedingInput: a sighting with a bad status is rejected", () => {
  const r = parseFeedingInput({
    id: ID,
    colonyId: COLONY,
    sightings: [{ id: SIGHTING, catId: CAT, status: "maybe" }],
  });
  assert.equal(r.ok, false);
});

test("parseFeedingInput: a sighting missing a valid id/catId is rejected", () => {
  assert.equal(
    parseFeedingInput({
      id: ID,
      colonyId: COLONY,
      sightings: [{ catId: CAT, status: "seen" }],
    }).ok,
    false,
  );
  assert.equal(
    parseFeedingInput({
      id: ID,
      colonyId: COLONY,
      sightings: [{ id: SIGHTING, catId: "nope", status: "seen" }],
    }).ok,
    false,
  );
});

test("parseFeedingInput: sightings must be a list when present", () => {
  assert.equal(
    parseFeedingInput({ id: ID, colonyId: COLONY, sightings: "x" }).ok,
    false,
  );
});

test("parseFeedingInput: rejects a non-object body", () => {
  assert.equal(parseFeedingInput(null).ok, false);
  assert.equal(parseFeedingInput("x").ok, false);
});
