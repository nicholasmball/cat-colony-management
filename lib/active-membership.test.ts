import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickActiveMembership,
  type ActiveMembershipRow,
} from "./active-membership.ts";

// Build a membership row in created_at order (the array order = DB order, since
// the query orders by created_at asc — this helper relies on that ordering).
function row(
  organisation_id: string,
  role: string,
  name = organisation_id,
): ActiveMembershipRow {
  return {
    organisation_id,
    role,
    organisations: { name, timezone: "Europe/Lisbon" },
  };
}

test("no rows → undefined (no membership to resolve)", () => {
  assert.equal(pickActiveMembership([]), undefined);
  assert.equal(pickActiveMembership([], "org-1"), undefined);
});

test("single row → that row (with or without a cookie)", () => {
  const only = row("org-1", "feeder");
  assert.equal(pickActiveMembership([only]), only);
  assert.equal(pickActiveMembership([only], "org-1"), only);
});

test("preferred org present in rows → that org's row (multi-org switcher)", () => {
  // Earliest is org-1 (admin); cookie selects org-2 — must NOT fall back to the
  // earliest just because it comes first.
  const rows = [row("org-1", "admin"), row("org-2", "caretaker")];
  const picked = pickActiveMembership(rows, "org-2");
  assert.equal(picked, rows[1]);
  assert.equal(picked?.role, "caretaker");
});

test("preferred org set but NOT in rows (stale cookie) → earliest", () => {
  const rows = [row("org-1", "admin"), row("org-2", "caretaker")];
  // org-9 is not one of the caller's memberships → fall back to earliest.
  assert.equal(pickActiveMembership(rows, "org-9"), rows[0]);
});

test("no preferred org → earliest by created_at (rows[0])", () => {
  const rows = [row("org-1", "feeder"), row("org-2", "admin")];
  assert.equal(pickActiveMembership(rows), rows[0]);
  assert.equal(pickActiveMembership(rows, undefined), rows[0]);
  assert.equal(pickActiveMembership(rows, ""), rows[0]);
});

// Regression for the "mis-scoped as admin" bug: selection operates SOLELY on the
// passed (already user-scoped) rows. It can only ever return one of them — it
// never invents or upgrades a role the input didn't contain. The user-scoping
// must therefore happen in the query; this asserts the helper adds no privilege.
test("never returns a role the input didn't contain (user-scoped input only)", () => {
  // This caller is a feeder in org-1 and a caretaker in org-2 — no admin row.
  const rows = [row("org-1", "feeder"), row("org-2", "caretaker")];
  const inputRoles = new Set(rows.map((r) => r.role));

  for (const cookie of [undefined, "org-1", "org-2", "org-stale"]) {
    const picked = pickActiveMembership(rows, cookie);
    assert.ok(picked != null);
    // Returns an actual input row object — not a fabricated one.
    assert.ok(rows.includes(picked));
    assert.ok(inputRoles.has(picked.role));
    assert.notEqual(picked.role, "admin");
  }
});
