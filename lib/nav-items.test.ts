import { test } from "node:test";
import assert from "node:assert/strict";
import { navItemsFor } from "./nav-items.ts";

const labels = (role?: string | null) =>
  navItemsFor({ role }).map((i) => i.label);

test("feeder omits Home and Incidents, leading with Today", () => {
  const ls = labels("feeder");
  assert.deepEqual(ls, ["Today", "Colonies"]);
  assert.equal(ls[0], "Today");
  assert.ok(!ls.includes("Home"));
  // Feeders have no triage list — they reach an incident only via a link.
  assert.ok(!ls.includes("Incidents"));
});

test("caretaker keeps Home and gets Incidents but no admin items", () => {
  const ls = labels("caretaker");
  assert.deepEqual(ls, ["Home", "Today", "Colonies", "Incidents"]);
  // Incidents is a manager item (admin + caretaker), unlike admin-only Members.
  assert.ok(ls.includes("Incidents"));
  assert.ok(!ls.includes("Members"));
  assert.ok(!ls.includes("Organisation"));
});

test("admin keeps Home and gets Incidents + Members + Organisation", () => {
  const ls = labels("admin");
  assert.deepEqual(ls, [
    "Home",
    "Today",
    "Colonies",
    "Incidents",
    "Members",
    "Organisation",
  ]);
});

test("unknown/undefined role is treated as a feeder (no Home, no Incidents)", () => {
  assert.deepEqual(labels(undefined), ["Today", "Colonies"]);
  assert.deepEqual(labels(null), ["Today", "Colonies"]);
  assert.deepEqual(labels("stranger"), ["Today", "Colonies"]);
});

test("Home is exact-match so it only highlights on /app", () => {
  const home = navItemsFor({ role: "admin" }).find((i) => i.href === "/app");
  assert.equal(home?.exact, true);
});
