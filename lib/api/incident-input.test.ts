import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIncidentInput } from "./incident-input.ts";

const ID = "11111111-1111-4111-8111-111111111111";
const COLONY = "22222222-2222-4222-8222-222222222222";
const URGENCY = "55555555-5555-4555-8555-555555555555";
const CAT = "33333333-3333-4333-8333-333333333333";

test("parseIncidentInput: valid with just the required type", () => {
  const r = parseIncidentInput({ id: ID, colonyId: COLONY, type: "poisoning" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.type, "poisoning");
  assert.equal(r.value.urgencyLevelId, null);
  assert.equal(r.value.catId, null);
  assert.equal(r.value.notes, null);
  assert.equal(r.value.photoKey, null);
  assert.equal(r.value.photoFailed, false);
});

test("parseIncidentInput: full body maps every optional field", () => {
  const r = parseIncidentInput({
    id: ID,
    colonyId: COLONY,
    type: "sick_injured",
    urgencyLevelId: URGENCY,
    catId: CAT,
    notes: "  limping badly  ",
    photoKey: "org/abc/incidents/xyz/uuid.jpg",
    photoFailed: true,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.urgencyLevelId, URGENCY);
  assert.equal(r.value.catId, CAT);
  assert.equal(r.value.notes, "limping badly"); // trimmed
  assert.equal(r.value.photoKey, "org/abc/incidents/xyz/uuid.jpg");
  assert.equal(r.value.photoFailed, true);
});

test("parseIncidentInput: blank optional strings normalise to null", () => {
  const r = parseIncidentInput({
    id: ID,
    colonyId: COLONY,
    type: "other",
    urgencyLevelId: "",
    catId: "  ",
    notes: "",
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.urgencyLevelId, null);
  assert.equal(r.value.catId, null);
  assert.equal(r.value.notes, null);
});

test("parseIncidentInput: missing/invalid incident id is rejected", () => {
  assert.equal(
    parseIncidentInput({ colonyId: COLONY, type: "other" }).ok,
    false,
  );
  assert.equal(
    parseIncidentInput({ id: "nope", colonyId: COLONY, type: "other" }).ok,
    false,
  );
});

test("parseIncidentInput: missing/invalid colony id is rejected", () => {
  assert.equal(parseIncidentInput({ id: ID, type: "other" }).ok, false);
  assert.equal(
    parseIncidentInput({ id: ID, colonyId: "nope", type: "other" }).ok,
    false,
  );
});

test("parseIncidentInput: a bad/missing incident type is rejected", () => {
  assert.equal(parseIncidentInput({ id: ID, colonyId: COLONY }).ok, false);
  assert.equal(
    parseIncidentInput({ id: ID, colonyId: COLONY, type: "not_a_type" }).ok,
    false,
  );
});

test("parseIncidentInput: rejects a non-object body", () => {
  assert.equal(parseIncidentInput(null).ok, false);
  assert.equal(parseIncidentInput("x").ok, false);
});
