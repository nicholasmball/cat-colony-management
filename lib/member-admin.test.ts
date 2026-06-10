import { test } from "node:test";
import assert from "node:assert/strict";
import { canEraseMember } from "./member-admin.ts";

const ACTOR = "actor-1";
const TARGET = "target-1";

// A valid base input: a non-admin target who belongs to the org and is ACTIVE,
// plenty of admins around. Individual cases override exactly the field under test.
function base(overrides = {}) {
  return {
    actingUserId: ACTOR,
    targetUserId: TARGET,
    targetRole: "feeder" as const,
    adminCount: 2,
    targetInOrg: true,
    targetActive: true,
    ...overrides,
  };
}

test("canEraseMember: happy path — erase a feeder in the org", () => {
  assert.deepEqual(canEraseMember(base()), { ok: true });
});

test("canEraseMember: happy path — erase a caretaker in the org", () => {
  assert.deepEqual(canEraseMember(base({ targetRole: "caretaker" })), {
    ok: true,
  });
});

test("canEraseMember: happy path — erase an admin when other admins remain", () => {
  assert.deepEqual(
    canEraseMember(base({ targetRole: "admin", adminCount: 2 })),
    { ok: true },
  );
});

test("canEraseMember: blocked — cannot erase self", () => {
  assert.deepEqual(canEraseMember(base({ targetUserId: ACTOR })), {
    ok: false,
    reason: "cannotEraseSelf",
  });
});

test("canEraseMember: blocked — cannot erase the ACTIVE sole admin", () => {
  assert.deepEqual(
    canEraseMember(
      base({ targetRole: "admin", targetActive: true, adminCount: 1 }),
    ),
    { ok: false, reason: "cannotEraseLastAdmin" },
  );
});

test("canEraseMember: a DEACTIVATED admin is erasable even when adminCount<=1", () => {
  // adminCount counts ACTIVE admins only, so a deactivated admin isn't in that
  // pool — erasing them can't orphan the org, so the last-admin rail must NOT fire.
  assert.deepEqual(
    canEraseMember(
      base({ targetRole: "admin", targetActive: false, adminCount: 1 }),
    ),
    { ok: true },
  );
});

test("canEraseMember: a DEACTIVATED feeder is erasable", () => {
  assert.deepEqual(
    canEraseMember(base({ targetRole: "feeder", targetActive: false })),
    { ok: true },
  );
});

test("canEraseMember: blocked — target not in this org", () => {
  assert.deepEqual(canEraseMember(base({ targetInOrg: false })), {
    ok: false,
    reason: "memberNoLongerExists",
  });
});

test("canEraseMember: not-in-org beats self (gate is checked first)", () => {
  // Even if the ids match, a target who isn't in the org surfaces as
  // memberNoLongerExists — the authorisation gate runs before the self-check.
  assert.deepEqual(
    canEraseMember(base({ targetUserId: ACTOR, targetInOrg: false })),
    { ok: false, reason: "memberNoLongerExists" },
  );
});

test("canEraseMember: self beats last-admin (an admin erasing themselves is self)", () => {
  assert.deepEqual(
    canEraseMember(
      base({ targetUserId: ACTOR, targetRole: "admin", adminCount: 1 }),
    ),
    { ok: false, reason: "cannotEraseSelf" },
  );
});

test("canEraseMember: a non-admin is never blocked by the last-admin rule", () => {
  // adminCount can be 0/1 for a feeder target — irrelevant, they're not admin.
  assert.deepEqual(
    canEraseMember(base({ targetRole: "feeder", adminCount: 1 })),
    { ok: true },
  );
});
