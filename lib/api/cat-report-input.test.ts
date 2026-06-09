import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCatReportInput } from "./cat-report-input.ts";

const ID = "11111111-1111-4111-8111-111111111111";
const COLONY = "22222222-2222-4222-8222-222222222222";

test("parseCatReportInput: valid with a name only", () => {
  const r = parseCatReportInput({ id: ID, colonyId: COLONY, name: "  Tom  " });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.name, "Tom"); // trimmed
  assert.equal(r.value.tempId, null);
  assert.equal(r.value.neutered, null); // unknown default
});

test("parseCatReportInput: valid with a description (temp_id) only", () => {
  const r = parseCatReportInput({
    id: ID,
    colonyId: COLONY,
    tempId: "ginger by the bins",
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.name, null);
  assert.equal(r.value.tempId, "ginger by the bins");
});

test("parseCatReportInput: full body maps every optional field", () => {
  const r = parseCatReportInput({
    id: ID,
    colonyId: COLONY,
    name: "Tom",
    colour: "tabby",
    sex: "male",
    neutered: "yes",
    notes: "limping",
    photoKey: "org/abc/cats/_unassigned/xyz/uuid.jpg",
    photoFailed: false,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.colour, "tabby");
  assert.equal(r.value.sex, "male");
  assert.equal(r.value.neutered, true);
  assert.equal(r.value.notes, "limping");
  assert.equal(r.value.photoKey, "org/abc/cats/_unassigned/xyz/uuid.jpg");
  assert.equal(r.value.photoFailed, false);
});

test("parseCatReportInput: neutered tri-state maps yes/no/unknown", () => {
  const base = { id: ID, colonyId: COLONY, name: "Tom" };
  const yes = parseCatReportInput({ ...base, neutered: "yes" });
  const no = parseCatReportInput({ ...base, neutered: "no" });
  const unknown = parseCatReportInput({ ...base, neutered: "unknown" });
  assert.equal(yes.ok && yes.value.neutered, true);
  assert.equal(no.ok && no.value.neutered === false, true);
  assert.equal(unknown.ok && unknown.value.neutered, null);
});

test("parseCatReportInput: sex 'unknown'/'' normalises to null", () => {
  const r = parseCatReportInput({
    id: ID,
    colonyId: COLONY,
    name: "Tom",
    sex: "",
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.sex, null);
});

test("parseCatReportInput: photoFailed accepts boolean and '1'", () => {
  const r1 = parseCatReportInput({
    id: ID,
    colonyId: COLONY,
    name: "Tom",
    photoFailed: true,
  });
  const r2 = parseCatReportInput({
    id: ID,
    colonyId: COLONY,
    name: "Tom",
    photoFailed: "1",
  });
  assert.equal(r1.ok && r1.value.photoFailed, true);
  assert.equal(r2.ok && r2.value.photoFailed, true);
});

test("parseCatReportInput: no identifier (no name, no temp_id) is rejected", () => {
  assert.equal(parseCatReportInput({ id: ID, colonyId: COLONY }).ok, false);
  // Whitespace-only identifiers are still "no identifier".
  assert.equal(
    parseCatReportInput({ id: ID, colonyId: COLONY, name: "  ", tempId: " " })
      .ok,
    false,
  );
});

test("parseCatReportInput: missing/invalid cat id is rejected", () => {
  assert.equal(
    parseCatReportInput({ colonyId: COLONY, name: "Tom" }).ok,
    false,
  );
  assert.equal(
    parseCatReportInput({ id: "nope", colonyId: COLONY, name: "Tom" }).ok,
    false,
  );
});

test("parseCatReportInput: missing/invalid colony id is rejected", () => {
  assert.equal(parseCatReportInput({ id: ID, name: "Tom" }).ok, false);
  assert.equal(
    parseCatReportInput({ id: ID, colonyId: "nope", name: "Tom" }).ok,
    false,
  );
});

test("parseCatReportInput: rejects a non-object body", () => {
  assert.equal(parseCatReportInput(null).ok, false);
  assert.equal(parseCatReportInput(42).ok, false);
});
