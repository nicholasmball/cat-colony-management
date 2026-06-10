import { test } from "node:test";
import assert from "node:assert/strict";
import { inviteEmailPath } from "./invite-plan.ts";
import { send, type EmailAdapter, type SendArgs } from "./index.ts";

test("branded only when armed AND an acceptUrl exists", () => {
  assert.equal(inviteEmailPath("send", "https://x/accept?token=1"), "branded");
  assert.equal(inviteEmailPath("send", undefined), "fallback");
  assert.equal(inviteEmailPath("off", "https://x/accept?token=1"), "fallback");
  assert.equal(inviteEmailPath("off", undefined), "fallback");
});

// The invite wiring delegates the actual send to lib/email.send — assert the
// mocked-adapter behaviour the action relies on: armed → branded invite reaches
// the adapter; off → no-op, adapter never called.
const inviteArgs: SendArgs = {
  to: "vol@example.com",
  locale: "pt",
  template: "invite",
  params: {
    acceptUrl: "https://app.example.org/accept?token=tok",
    orgName: "Street Cats of Tavira",
    role: "feeder",
  },
};

test("armed invite → adapter called with the branded invite", async () => {
  process.env.EMAIL_ENABLED = "true";
  process.env.RESEND_API_KEY = "re_test";
  const calls: string[] = [];
  const adapter: EmailAdapter = async (m) => {
    calls.push(m.subject);
    return { ok: true, id: "x" };
  };

  const result = await send(inviteArgs, adapter);

  assert.equal(result.skipped, false);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes("Street Cats of Tavira"));
});

test("off invite → no-op, adapter NOT called", async () => {
  delete process.env.EMAIL_ENABLED;
  delete process.env.RESEND_API_KEY;
  let called = false;
  const adapter: EmailAdapter = async () => {
    called = true;
    return { ok: true };
  };

  const result = await send(inviteArgs, adapter);

  assert.deepEqual(result, { skipped: true });
  assert.equal(called, false);
});

test.after(() => {
  delete process.env.EMAIL_ENABLED;
  delete process.env.RESEND_API_KEY;
});
