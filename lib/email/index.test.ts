import { test } from "node:test";
import assert from "node:assert/strict";
import { send, type EmailAdapter, type SendArgs } from "./index.ts";

const inviteArgs: SendArgs = {
  to: "vol@example.com",
  locale: "en",
  template: "invite",
  params: {
    acceptUrl: "https://app.example.org/accept?token=abc",
    orgName: "Street Cats of Tavira",
    role: "feeder",
  },
};

// A spy adapter that records calls and returns a fixed result.
function spyAdapter(result: Awaited<ReturnType<EmailAdapter>>) {
  const calls: Parameters<EmailAdapter>[0][] = [];
  const adapter: EmailAdapter = async (message) => {
    calls.push(message);
    return result;
  };
  return { adapter, calls };
}

test("off (no flag) → skipped no-op, adapter never called, never throws", async () => {
  delete process.env.EMAIL_ENABLED;
  delete process.env.RESEND_API_KEY;
  const { adapter, calls } = spyAdapter({ ok: true });

  const result = await send(inviteArgs, adapter);

  assert.deepEqual(result, { skipped: true });
  assert.equal(calls.length, 0, "adapter must not be called when off");
});

test("enabled but no key → still off (armed-ready: needs both)", async () => {
  process.env.EMAIL_ENABLED = "true";
  delete process.env.RESEND_API_KEY;
  const { adapter, calls } = spyAdapter({ ok: true });

  const result = await send(inviteArgs, adapter);

  assert.deepEqual(result, { skipped: true });
  assert.equal(calls.length, 0);
});

test("armed (flag + key) → renders + calls adapter with the from/subject", async () => {
  process.env.EMAIL_ENABLED = "true";
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.EMAIL_FROM = "SCoT <no-reply@example.org>";
  const { adapter, calls } = spyAdapter({ ok: true, id: "msg_1" });

  const result = await send(inviteArgs, adapter);

  assert.deepEqual(result, { skipped: false, ok: true, id: "msg_1" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].from, "SCoT <no-reply@example.org>");
  assert.equal(calls[0].to, "vol@example.com");
  assert.ok(calls[0].subject.length > 0);
  assert.ok(calls[0].html.includes("token=abc"), "accept url in html");
  assert.ok(calls[0].text.includes("token=abc"), "accept url in text part");
});

test("armed but adapter returns failure → typed failure, no throw", async () => {
  process.env.EMAIL_ENABLED = "true";
  process.env.RESEND_API_KEY = "re_test_key";
  const { adapter } = spyAdapter({ ok: false, error: "rate limited" });

  const result = await send(inviteArgs, adapter);

  assert.deepEqual(result, {
    skipped: false,
    ok: false,
    error: "rate limited",
  });
});

test("armed but adapter THROWS → caught, returns typed failure, never throws", async () => {
  process.env.EMAIL_ENABLED = "true";
  process.env.RESEND_API_KEY = "re_test_key";
  const adapter: EmailAdapter = async () => {
    throw new Error("network down");
  };

  const result = await send(inviteArgs, adapter);

  assert.deepEqual(result, {
    skipped: false,
    ok: false,
    error: "network down",
  });
});

test.after(() => {
  delete process.env.EMAIL_ENABLED;
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
});
