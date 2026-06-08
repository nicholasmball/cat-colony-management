import { test } from "node:test";
import assert from "node:assert/strict";
import { firstRunDestination } from "./pending-invite.ts";

test("firstRunDestination keeps a member in the app", () => {
  assert.equal(
    firstRunDestination({ hasMembership: true, hasPendingInvite: false }),
    "app",
  );
});

test("firstRunDestination routes an invitee with no membership to accept", () => {
  assert.equal(
    firstRunDestination({ hasMembership: false, hasPendingInvite: true }),
    "accept",
  );
});

test("firstRunDestination sends a brand-new user to create-org", () => {
  assert.equal(
    firstRunDestination({ hasMembership: false, hasPendingInvite: false }),
    "create-org",
  );
});

test("firstRunDestination prefers membership over a stray pending invite", () => {
  // Edge: an existing member who also has a lingering open invite should not
  // be bounced to /accept.
  assert.equal(
    firstRunDestination({ hasMembership: true, hasPendingInvite: true }),
    "app",
  );
});
