import { test } from "node:test";
import assert from "node:assert/strict";
import { navItemsFor } from "./nav-items.ts";

const labels = (role?: string | null) =>
  navItemsFor({ role }).map((i) => i.label);

test("feeder omits Dashboard and Incidents, leading with Today", () => {
  const ls = labels("feeder");
  assert.deepEqual(ls, ["Today", "Colonies"]);
  assert.equal(ls[0], "Today");
  // Dashboard is a manager item — feeders never see it (no Home either).
  assert.ok(!ls.includes("Dashboard"));
  assert.ok(!ls.includes("Home"));
  // Feeders have no triage list — they reach an incident only via a link.
  assert.ok(!ls.includes("Incidents"));
});

test("caretaker leads with Dashboard and gets Incidents but no admin items", () => {
  const ls = labels("caretaker");
  assert.deepEqual(ls, ["Dashboard", "Today", "Colonies", "Incidents"]);
  // Dashboard replaces the old Home item and is first for managers.
  assert.equal(ls[0], "Dashboard");
  assert.ok(!ls.includes("Home"));
  // Incidents is a manager item (admin + caretaker), unlike admin-only Members.
  assert.ok(ls.includes("Incidents"));
  assert.ok(!ls.includes("Members"));
  assert.ok(!ls.includes("Organisation"));
});

test("admin leads with Dashboard and gets Incidents + Members + Organisation", () => {
  const ls = labels("admin");
  assert.deepEqual(ls, [
    "Dashboard",
    "Today",
    "Colonies",
    "Incidents",
    "Members",
    "Organisation",
  ]);
});

test("unknown/undefined role is treated as a feeder (no Dashboard, no Incidents)", () => {
  assert.deepEqual(labels(undefined), ["Today", "Colonies"]);
  assert.deepEqual(labels(null), ["Today", "Colonies"]);
  assert.deepEqual(labels("stranger"), ["Today", "Colonies"]);
});

test("Dashboard is exact-match so it only highlights on /app/dashboard", () => {
  const dash = navItemsFor({ role: "admin" }).find(
    (i) => i.href === "/app/dashboard",
  );
  assert.equal(dash?.exact, true);
});
