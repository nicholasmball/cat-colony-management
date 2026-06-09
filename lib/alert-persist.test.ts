import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAlertRows } from "./alert-persist.ts";
import type { AlertSpec } from "./alert-engine.ts";

const ROUTINE: AlertSpec = {
  type: "new_cat",
  severity: "routine",
  message_key: "alerts.new_cat",
  message_params: {
    colonyName: "Riverside",
    catName: "Smudge",
    reporterName: "Ana",
  },
  colony_id: "col1",
  cat_id: "cat1",
  dedup_key: "new_cat:cat1",
};

const URGENT: AlertSpec = {
  type: "incident_urgent",
  severity: "urgent",
  message_key: "alerts.incident_urgent",
  message_params: {
    incidentType: "poisoning",
    colonyName: "Riverside",
    reporterName: "Ana",
  },
  colony_id: "col1",
  incident_id: "inc1",
  dedup_key: "incident_urgent:inc1",
};

test("fans one row per recipient × spec", () => {
  const rows = buildAlertRows("org1", [ROUTINE, URGENT], ["u1", "u2"]);
  assert.equal(rows.length, 4);
});

test("no specs or no recipients → no rows", () => {
  assert.deepEqual(buildAlertRows("org1", [], ["u1"]), []);
  assert.deepEqual(buildAlertRows("org1", [ROUTINE], []), []);
});

test("routine row carries in_app+email channel intent, no dispatched_at", () => {
  const [row] = buildAlertRows("org1", [ROUTINE], ["u1"]);
  assert.equal(row.organisation_id, "org1");
  assert.equal(row.recipient_id, "u1");
  assert.equal(row.type, "new_cat");
  assert.equal(row.severity, "routine");
  assert.equal(row.message_key, "alerts.new_cat");
  assert.deepEqual(row.channels, ["in_app", "email"]);
  assert.equal(row.colony_id, "col1");
  assert.equal(row.cat_id, "cat1");
  assert.equal(row.incident_id, null);
  assert.equal(row.dedup_key, "new_cat:cat1");
  // The dispatch marker is never set on insert (records intent only).
  assert.ok(!("dispatched_at" in row));
});

test("urgent row carries push+sms channel intent and the incident FK", () => {
  const [row] = buildAlertRows("org1", [URGENT], ["u1"]);
  assert.equal(row.severity, "urgent");
  assert.deepEqual(row.channels, ["push", "sms"]);
  assert.equal(row.incident_id, "inc1");
  assert.equal(row.cat_id, null);
});

test("absent optional FKs become null, not undefined", () => {
  const feedingMissed: AlertSpec = {
    type: "feeding_missed",
    severity: "routine",
    message_key: "alerts.feeding_missed",
    message_params: { colonyName: "Riverside", hours: 12 },
    colony_id: "col1",
    dedup_key: "feeding_missed:col1:2026-06-09",
  };
  const [row] = buildAlertRows("org1", [feedingMissed], ["u1"]);
  assert.equal(row.cat_id, null);
  assert.equal(row.incident_id, null);
  assert.equal(row.colony_id, "col1");
});
