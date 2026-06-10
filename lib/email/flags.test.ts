import { test } from "node:test";
import assert from "node:assert/strict";
import { emailMode } from "./flags.ts";

// Full truth table: "send" iff BOTH enabled AND a key are present. This is the
// armed-ready contract — intent without capability (or capability without
// intent) stays "off" so the layer never tries to send half-configured.
test("emailMode truth table", () => {
  assert.equal(emailMode({ enabled: true, hasKey: true }), "send");
  assert.equal(emailMode({ enabled: true, hasKey: false }), "off");
  assert.equal(emailMode({ enabled: false, hasKey: true }), "off");
  assert.equal(emailMode({ enabled: false, hasKey: false }), "off");
});
