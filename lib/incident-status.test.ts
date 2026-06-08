import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canTransitionIncident,
  isIncidentStatus,
  TRANSITION_REASON,
} from "./incident-status.ts";

test("isIncidentStatus: only the three UI states pass", () => {
  assert.equal(isIncidentStatus("open"), true);
  assert.equal(isIncidentStatus("in_progress"), true);
  assert.equal(isIncidentStatus("resolved"), true);
  // 'closed' is a DB enum value but never a UI transition target.
  assert.equal(isIncidentStatus("closed"), false);
  assert.equal(isIncidentStatus("nonsense"), false);
  assert.equal(isIncidentStatus(undefined), false);
});

// ── Allowed edges (manager) ──────────────────────────────────────────────────
test("canTransitionIncident: open → in_progress allowed", () => {
  const r = canTransitionIncident({
    actorRole: "caretaker",
    from: "open",
    to: "in_progress",
  });
  assert.deepEqual(r, { ok: true, noop: false });
});

test("canTransitionIncident: open → resolved allowed", () => {
  const r = canTransitionIncident({
    actorRole: "admin",
    from: "open",
    to: "resolved",
  });
  assert.deepEqual(r, { ok: true, noop: false });
});

test("canTransitionIncident: in_progress → resolved allowed", () => {
  const r = canTransitionIncident({
    actorRole: "caretaker",
    from: "in_progress",
    to: "resolved",
  });
  assert.deepEqual(r, { ok: true, noop: false });
});

test("canTransitionIncident: resolved → open (reopen) allowed", () => {
  const r = canTransitionIncident({
    actorRole: "admin",
    from: "resolved",
    to: "open",
  });
  assert.deepEqual(r, { ok: true, noop: false });
});

// ── Rejected edges ───────────────────────────────────────────────────────────
test("canTransitionIncident: in_progress → open rejected (no backward except reopen)", () => {
  const r = canTransitionIncident({
    actorRole: "caretaker",
    from: "in_progress",
    to: "open",
  });
  assert.deepEqual(r, { ok: false, reason: TRANSITION_REASON.illegalEdge });
});

test("canTransitionIncident: resolved → in_progress rejected (reopen goes to open)", () => {
  const r = canTransitionIncident({
    actorRole: "admin",
    from: "resolved",
    to: "in_progress",
  });
  assert.deepEqual(r, { ok: false, reason: TRANSITION_REASON.illegalEdge });
});

// ── Role gate ────────────────────────────────────────────────────────────────
test("canTransitionIncident: feeder blocked on any edge", () => {
  const r = canTransitionIncident({
    actorRole: "feeder",
    from: "open",
    to: "in_progress",
  });
  assert.deepEqual(r, { ok: false, reason: TRANSITION_REASON.notManager });
});

test("canTransitionIncident: caretaker and admin both pass the role gate", () => {
  for (const role of ["caretaker", "admin"]) {
    const r = canTransitionIncident({
      actorRole: role,
      from: "open",
      to: "resolved",
    });
    assert.deepEqual(r, { ok: true, noop: false });
  }
});

test("canTransitionIncident: unknown role blocked", () => {
  const r = canTransitionIncident({
    actorRole: "stranger",
    from: "open",
    to: "resolved",
  });
  assert.deepEqual(r, { ok: false, reason: TRANSITION_REASON.notManager });
});

// ── No-op ────────────────────────────────────────────────────────────────────
test("canTransitionIncident: same status is a no-op", () => {
  const r = canTransitionIncident({
    actorRole: "caretaker",
    from: "in_progress",
    to: "in_progress",
  });
  assert.deepEqual(r, { ok: true, noop: true });
});

// ── Unknown target / source ──────────────────────────────────────────────────
test("canTransitionIncident: unknown target status rejected", () => {
  const r = canTransitionIncident({
    actorRole: "admin",
    from: "open",
    to: "closed",
  });
  assert.deepEqual(r, { ok: false, reason: TRANSITION_REASON.unknownStatus });
});

test("canTransitionIncident: role gate beats unknown status (order is defensive)", () => {
  const r = canTransitionIncident({
    actorRole: "feeder",
    from: "open",
    to: "closed",
  });
  assert.deepEqual(r, { ok: false, reason: TRANSITION_REASON.notManager });
});

test("canTransitionIncident: a non-UI source (closed) has no legal outgoing edge", () => {
  const r = canTransitionIncident({
    actorRole: "admin",
    from: "closed",
    to: "open",
  });
  assert.deepEqual(r, { ok: false, reason: TRANSITION_REASON.illegalEdge });
});
