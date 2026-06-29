import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MEMBERS_PATH,
  resolveInviteReturn,
  inviteReturnPath,
} from "./invite-return.ts";
import { inviteRoleFromInput } from "./member-role.ts";

const UUID = "46c8fdda-1a5e-481f-bc9e-4f98069afd91";

// ── resolveInviteReturn: the server-trusted source → path mapping ───────────

test("resolveInviteReturn: schedule source + a valid uuid → the schedule path", () => {
  assert.equal(
    resolveInviteReturn({ source: "schedule", colonyId: UUID }),
    `/app/colonies/${UUID}/schedules/new`,
  );
});

test("resolveInviteReturn: no source (the Members call site) → the Members default", () => {
  assert.equal(resolveInviteReturn({ source: "", colonyId: "" }), MEMBERS_PATH);
});

test("resolveInviteReturn: an unknown source falls back to Members (never an arbitrary path)", () => {
  assert.equal(
    resolveInviteReturn({ source: "evil", colonyId: UUID }),
    MEMBERS_PATH,
  );
});

test("resolveInviteReturn: a malicious/invalid colonyId can't escape the path — falls back to Members", () => {
  // Anything that isn't a bare uuid (path traversal, a full URL, junk) is
  // rejected, so this can never become an open redirect.
  for (const colonyId of [
    "../../evil",
    "https://evil.example.com",
    `${UUID}/../../etc`,
    "not-a-uuid",
    "",
  ]) {
    assert.equal(
      resolveInviteReturn({ source: "schedule", colonyId }),
      MEMBERS_PATH,
      `expected Members fallback for colonyId=${JSON.stringify(colonyId)}`,
    );
  }
});

test("inviteReturnPath: appends the invited + sent query the schedule page reads", () => {
  assert.equal(
    inviteReturnPath({
      source: "schedule",
      colonyId: UUID,
      email: "new@example.com",
      sent: true,
    }),
    `/app/colonies/${UUID}/schedules/new?invited=new%40example.com&sent=1`,
  );
});

test("inviteReturnPath: Members default with sent=0 matches the legacy redirect shape", () => {
  assert.equal(
    inviteReturnPath({
      source: "",
      colonyId: "",
      email: "a@b.co",
      sent: false,
    }),
    `${MEMBERS_PATH}?invited=a%40b.co&sent=0`,
  );
});

// ── inviteRoleFromInput: the server-side role default ───────────────────────

test("inviteRoleFromInput: a blank/absent role defaults to feeder (the schedule-form path)", () => {
  assert.equal(inviteRoleFromInput(""), "feeder");
  assert.equal(inviteRoleFromInput("   "), "feeder");
});

test("inviteRoleFromInput: a valid role is preserved (the Members form path)", () => {
  assert.equal(inviteRoleFromInput("feeder"), "feeder");
  assert.equal(inviteRoleFromInput("caretaker"), "caretaker");
  assert.equal(inviteRoleFromInput("admin"), "admin");
});

test("inviteRoleFromInput: a non-blank but invalid role is rejected (null), never coerced", () => {
  assert.equal(inviteRoleFromInput("owner"), null);
  assert.equal(inviteRoleFromInput("superadmin"), null);
  assert.equal(inviteRoleFromInput("Admin"), null);
});
