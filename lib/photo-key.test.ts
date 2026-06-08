import { test } from "node:test";
import assert from "node:assert/strict";
import { isKeyInOrg } from "./photo-key.ts";

const ORG = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

// ── happy path ──
test("isKeyInOrg accepts a key under the org's prefix", () => {
  assert.equal(isKeyInOrg(`org/${ORG}/cats/abc/photo.jpg`, ORG), true);
});

test("isKeyInOrg accepts the colony-scoped report/incident prefixes", () => {
  assert.equal(
    isKeyInOrg(`org/${ORG}/cats/_unassigned/col/photo.jpg`, ORG),
    true,
  );
  assert.equal(isKeyInOrg(`org/${ORG}/incidents/col/photo.jpg`, ORG), true);
});

// ── cross-org ──
test("isKeyInOrg rejects a key under a different org's prefix", () => {
  assert.equal(isKeyInOrg(`org/${OTHER}/cats/abc/photo.jpg`, ORG), false);
});

// ── edge cases ──
test("isKeyInOrg rejects empty / nullish key or org", () => {
  assert.equal(isKeyInOrg("", ORG), false);
  assert.equal(isKeyInOrg(null, ORG), false);
  assert.equal(isKeyInOrg(undefined, ORG), false);
  assert.equal(isKeyInOrg(`org/${ORG}/x.jpg`, ""), false);
  assert.equal(isKeyInOrg(`org/${ORG}/x.jpg`, null), false);
});

test("isKeyInOrg rejects a malformed key missing the trailing slash", () => {
  // `org/{ORG}` with no `/…` after it must not match — guards against an org id
  // that is a prefix of another (e.g. `org/abc` vs `org/abcd`).
  assert.equal(isKeyInOrg(`org/${ORG}`, ORG), false);
  assert.equal(isKeyInOrg(`org/${ORG}extra/x.jpg`, ORG), false);
});

test("isKeyInOrg rejects a key that only contains the prefix elsewhere", () => {
  assert.equal(isKeyInOrg(`cats/org/${ORG}/x.jpg`, ORG), false);
});
