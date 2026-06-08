import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultUrgencyLevel,
  isValidIncidentType,
  INCIDENT_TYPES,
  type UrgencyLevel,
} from "./incident.ts";

const lvl = (over: Partial<UrgencyLevel>): UrgencyLevel => ({
  id: "x",
  key: "k",
  label: "L",
  sort_order: 0,
  alerts_immediately: false,
  ...over,
});

// ── defaultUrgencyLevel ──────────────────────────────────────────────────────

test("defaultUrgencyLevel: picks the not-urgent level when both exist", () => {
  const urgent = lvl({ id: "u", key: "urgent", sort_order: 0, alerts_immediately: true });
  const notUrgent = lvl({ id: "n", key: "not_urgent", sort_order: 1 });
  // Urgent sorts first, but the not-alerting level is the default.
  assert.equal(defaultUrgencyLevel([urgent, notUrgent])?.id, "n");
  // Order of input must not matter.
  assert.equal(defaultUrgencyLevel([notUrgent, urgent])?.id, "n");
});

test("defaultUrgencyLevel: empty list returns null (config error upstream)", () => {
  assert.equal(defaultUrgencyLevel([]), null);
});

test("defaultUrgencyLevel: a single level is returned even if it alerts", () => {
  const only = lvl({ id: "o", key: "urgent", alerts_immediately: true });
  assert.equal(defaultUrgencyLevel([only])?.id, "o");
});

test("defaultUrgencyLevel: with no calm level, falls back to lowest sort", () => {
  const high = lvl({ id: "h", key: "urgent", sort_order: 5, alerts_immediately: true });
  const low = lvl({ id: "l", key: "critical", sort_order: 1, alerts_immediately: true });
  assert.equal(defaultUrgencyLevel([high, low])?.id, "l");
});

test("defaultUrgencyLevel: picks lowest-sort among multiple calm levels", () => {
  const a = lvl({ id: "a", sort_order: 3 });
  const b = lvl({ id: "b", sort_order: 1 });
  assert.equal(defaultUrgencyLevel([a, b])?.id, "b");
});

// ── isValidIncidentType ──────────────────────────────────────────────────────

test("isValidIncidentType: accepts every real enum member", () => {
  for (const t of INCIDENT_TYPES) assert.equal(isValidIncidentType(t), true);
});

test("isValidIncidentType: rejects unknown / wrong-shape values", () => {
  // The design doc's wrong strings must be rejected — schema is the truth.
  assert.equal(isValidIncidentType("threat"), false);
  assert.equal(isValidIncidentType("feeding_access"), false);
  assert.equal(isValidIncidentType(""), false);
  assert.equal(isValidIncidentType(undefined), false);
  assert.equal(isValidIncidentType(null), false);
  assert.equal(isValidIncidentType(7), false);
});
