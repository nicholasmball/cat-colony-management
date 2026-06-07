import { test } from "node:test";
import assert from "node:assert/strict";
import { canChangeRole, isDemotion, ROLE_REASON } from "./member-role.ts";

// A valid active target with a given current role, used as a base for cases.
function target(currentRole: "admin" | "caretaker" | "feeder", overrides = {}) {
  return { userId: "target-1", currentRole, isActive: true, ...overrides };
}

const ACTOR = "actor-1";

test("isDemotion: drops in privilege are demotions", () => {
  assert.equal(isDemotion("admin", "caretaker"), true);
  assert.equal(isDemotion("admin", "feeder"), true);
  assert.equal(isDemotion("caretaker", "feeder"), true);
});

test("isDemotion: promotions and no-ops are not demotions", () => {
  assert.equal(isDemotion("feeder", "caretaker"), false);
  assert.equal(isDemotion("caretaker", "admin"), false);
  assert.equal(isDemotion("feeder", "admin"), false);
  assert.equal(isDemotion("admin", "admin"), false);
});

test("canChangeRole: valid promote feeder → caretaker", () => {
  const r = canChangeRole({
    actorUserId: ACTOR,
    target: target("feeder"),
    newRole: "caretaker",
    activeAdminCount: 1,
  });
  assert.deepEqual(r, { ok: true, noop: false });
});

test("canChangeRole: valid promote caretaker → admin", () => {
  const r = canChangeRole({
    actorUserId: ACTOR,
    target: target("caretaker"),
    newRole: "admin",
    activeAdminCount: 1,
  });
  assert.deepEqual(r, { ok: true, noop: false });
});

test("canChangeRole: valid demote admin → caretaker when >1 admin", () => {
  const r = canChangeRole({
    actorUserId: ACTOR,
    target: target("admin"),
    newRole: "caretaker",
    activeAdminCount: 2,
  });
  assert.deepEqual(r, { ok: true, noop: false });
});

test("canChangeRole: self-change blocked", () => {
  const r = canChangeRole({
    actorUserId: ACTOR,
    target: target("caretaker", { userId: ACTOR }),
    newRole: "admin",
    activeAdminCount: 2,
  });
  assert.deepEqual(r, { ok: false, reason: ROLE_REASON.selfChange });
});

test("canChangeRole: last-admin demote blocked (activeAdminCount = 1)", () => {
  const r = canChangeRole({
    actorUserId: ACTOR,
    target: target("admin"),
    newRole: "feeder",
    activeAdminCount: 1,
  });
  assert.deepEqual(r, { ok: false, reason: ROLE_REASON.lastAdmin });
});

test("canChangeRole: last-admin demote allowed when activeAdminCount >= 2", () => {
  const r = canChangeRole({
    actorUserId: ACTOR,
    target: target("admin"),
    newRole: "feeder",
    activeAdminCount: 2,
  });
  assert.deepEqual(r, { ok: true, noop: false });
});

test("canChangeRole: promoting an admin to admin elsewhere is not blocked by last-admin", () => {
  // Sole admin staying admin is a no-op, not a last-admin violation.
  const r = canChangeRole({
    actorUserId: ACTOR,
    target: target("admin"),
    newRole: "admin",
    activeAdminCount: 1,
  });
  assert.deepEqual(r, { ok: true, noop: true });
});

test("canChangeRole: inactive target blocked", () => {
  const r = canChangeRole({
    actorUserId: ACTOR,
    target: target("feeder", { isActive: false }),
    newRole: "caretaker",
    activeAdminCount: 2,
  });
  assert.deepEqual(r, { ok: false, reason: ROLE_REASON.inactive });
});

test("canChangeRole: invalid role blocked", () => {
  const r = canChangeRole({
    actorUserId: ACTOR,
    target: target("feeder"),
    newRole: "superuser",
    activeAdminCount: 2,
  });
  assert.deepEqual(r, { ok: false, reason: ROLE_REASON.invalidRole });
});

test("canChangeRole: no-op signalled (newRole === currentRole)", () => {
  const r = canChangeRole({
    actorUserId: ACTOR,
    target: target("caretaker"),
    newRole: "caretaker",
    activeAdminCount: 2,
  });
  assert.deepEqual(r, { ok: true, noop: true });
});

test("canChangeRole: invalid role beats self-change (order is defensive)", () => {
  const r = canChangeRole({
    actorUserId: ACTOR,
    target: target("feeder", { userId: ACTOR }),
    newRole: "nonsense",
    activeAdminCount: 2,
  });
  assert.deepEqual(r, { ok: false, reason: ROLE_REASON.invalidRole });
});
