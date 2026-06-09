import { test } from "node:test";
import assert from "node:assert/strict";
import { navItemsFor } from "./nav-items.ts";

// nav-items is pure and React-free: it carries i18n KEYS, not display strings
// (the label is translated in components/app-nav.tsx). Assert on the keys.
const keys = (role?: string | null) =>
  navItemsFor({ role }).map((i) => i.labelKey);

test("feeder omits Dashboard and Incidents, leading with Today", () => {
  const ls = keys("feeder");
  assert.deepEqual(ls, ["nav.today", "nav.colonies"]);
  assert.equal(ls[0], "nav.today");
  // Dashboard is a manager item — feeders never see it (no Home either).
  assert.ok(!ls.includes("nav.dashboard"));
  assert.ok(!ls.includes("nav.home"));
  // Feeders have no triage list — they reach an incident only via a link.
  assert.ok(!ls.includes("nav.incidents"));
});

test("caretaker leads with Dashboard and gets Incidents but no admin items", () => {
  const ls = keys("caretaker");
  assert.deepEqual(ls, [
    "nav.dashboard",
    "nav.today",
    "nav.colonies",
    "nav.incidents",
  ]);
  // Dashboard replaces the old Home item and is first for managers.
  assert.equal(ls[0], "nav.dashboard");
  assert.ok(!ls.includes("nav.home"));
  // Incidents is a manager item (admin + caretaker), unlike admin-only Members.
  assert.ok(ls.includes("nav.incidents"));
  assert.ok(!ls.includes("nav.members"));
  assert.ok(!ls.includes("nav.org"));
});

test("admin leads with Dashboard and gets Incidents + Members + Organisation", () => {
  const ls = keys("admin");
  assert.deepEqual(ls, [
    "nav.dashboard",
    "nav.today",
    "nav.colonies",
    "nav.incidents",
    "nav.members",
    "nav.org",
  ]);
});

test("unknown/undefined role is treated as a feeder (no Dashboard, no Incidents)", () => {
  assert.deepEqual(keys(undefined), ["nav.today", "nav.colonies"]);
  assert.deepEqual(keys(null), ["nav.today", "nav.colonies"]);
  assert.deepEqual(keys("stranger"), ["nav.today", "nav.colonies"]);
});

test("Dashboard is exact-match so it only highlights on /app/dashboard", () => {
  const dash = navItemsFor({ role: "admin" }).find(
    (i) => i.href === "/app/dashboard",
  );
  assert.equal(dash?.exact, true);
});
