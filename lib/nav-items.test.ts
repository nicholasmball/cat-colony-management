import { test } from "node:test";
import assert from "node:assert/strict";
import { navItemsFor, splitNavForTabbar } from "./nav-items.ts";

// nav-items is pure and React-free: it carries i18n KEYS, not display strings
// (the label is translated in components/app-nav.tsx). Assert on the keys.
const keys = (role?: string | null) =>
  navItemsFor({ role }).map((i) => i.labelKey);

test("feeder omits Dashboard and Incidents, leading with Today and ending with Feedback", () => {
  const ls = keys("feeder");
  assert.deepEqual(ls, [
    "nav.today",
    "nav.colonies",
    "nav.help",
    "nav.feedback",
  ]);
  assert.equal(ls[0], "nav.today");
  // Dashboard is a manager item — feeders never see it (no Home either).
  assert.ok(!ls.includes("nav.dashboard"));
  assert.ok(!ls.includes("nav.home"));
  // Feeders have no triage list — they reach an incident only via a link.
  assert.ok(!ls.includes("nav.incidents"));
  // Help is for every role — feeders most of all (no training).
  assert.ok(ls.includes("nav.help"));
});

test("caretaker leads with Dashboard and gets Incidents + Notifications + Alerts but no admin items", () => {
  const ls = keys("caretaker");
  assert.deepEqual(ls, [
    "nav.dashboard",
    "nav.today",
    "nav.colonies",
    "nav.incidents",
    "nav.notifications",
    "nav.alerts",
    "nav.help",
    "nav.feedback",
  ]);
  // Dashboard replaces the old Home item and is first for managers.
  assert.equal(ls[0], "nav.dashboard");
  assert.ok(!ls.includes("nav.home"));
  // Incidents + Notifications + Alerts are manager items (admin + caretaker),
  // unlike admin-only Members.
  assert.ok(ls.includes("nav.incidents"));
  assert.ok(ls.includes("nav.notifications"));
  assert.ok(ls.includes("nav.alerts"));
  assert.ok(!ls.includes("nav.members"));
  assert.ok(!ls.includes("nav.org"));
});

test("admin leads with Dashboard and gets Incidents + Notifications + Alerts + Members + Organisation", () => {
  const ls = keys("admin");
  assert.deepEqual(ls, [
    "nav.dashboard",
    "nav.today",
    "nav.colonies",
    "nav.incidents",
    "nav.notifications",
    "nav.alerts",
    "nav.members",
    "nav.org",
    "nav.help",
    "nav.feedback",
  ]);
});

test("every role gets Help, and Feedback always trails the list (after Help)", () => {
  for (const role of ["feeder", "caretaker", "admin", undefined]) {
    const ls = keys(role);
    assert.ok(ls.includes("nav.help"), `role ${role} should see Help`);
    assert.ok(ls.includes("nav.feedback"), `role ${role} should see Feedback`);
    // Feedback is appended LAST, immediately after Help, for every role.
    assert.equal(
      ls.at(-1),
      "nav.feedback",
      `Feedback should be last for ${role}`,
    );
    assert.equal(
      ls.at(-2),
      "nav.help",
      `Help should sit just before Feedback for ${role}`,
    );
  }
});

test("feeders never see the manager-only Notifications or Alerts items", () => {
  assert.ok(!keys("feeder").includes("nav.notifications"));
  assert.ok(!keys("feeder").includes("nav.alerts"));
});

test("unknown/undefined role is treated as a feeder (no Dashboard, no Incidents)", () => {
  const feeder = ["nav.today", "nav.colonies", "nav.help", "nav.feedback"];
  assert.deepEqual(keys(undefined), feeder);
  assert.deepEqual(keys(null), feeder);
  assert.deepEqual(keys("stranger"), feeder);
  assert.ok(!keys("stranger").includes("nav.notifications"));
});

test("splitNavForTabbar: feeder (4 items incl. Feedback) all visible, no overflow", () => {
  const { visible, overflow } = splitNavForTabbar(
    navItemsFor({ role: "feeder" }),
  );
  assert.equal(visible.length, 4);
  assert.equal(overflow.length, 0);
  // Both Help and Feedback stay inline for feeders (≤5, no overflow) — neither
  // bumps a working primary cell.
  assert.ok(visible.some((i) => i.labelKey === "nav.help"));
  assert.ok(visible.some((i) => i.labelKey === "nav.feedback"));
});

test("splitNavForTabbar: <= maxCells stays fully visible (no cramming, no More)", () => {
  const five = navItemsFor({ role: "admin" }).slice(0, 5);
  const { visible, overflow } = splitNavForTabbar(five);
  assert.equal(visible.length, 5);
  assert.equal(overflow.length, 0);
});

test("splitNavForTabbar: caretaker (8) → 4 visible + 4 in More (incl. Help + Feedback)", () => {
  const { visible, overflow } = splitNavForTabbar(
    navItemsFor({ role: "caretaker" }),
  );
  assert.deepEqual(
    visible.map((i) => i.labelKey),
    ["nav.dashboard", "nav.today", "nav.colonies", "nav.incidents"],
  );
  assert.deepEqual(
    overflow.map((i) => i.labelKey),
    ["nav.notifications", "nav.alerts", "nav.help", "nav.feedback"],
  );
});

test("splitNavForTabbar: admin (10) → 4 visible + 6 in More (bar never exceeds 5 cells)", () => {
  const { visible, overflow } = splitNavForTabbar(
    navItemsFor({ role: "admin" }),
  );
  assert.equal(visible.length, 4);
  assert.deepEqual(
    overflow.map((i) => i.labelKey),
    [
      "nav.notifications",
      "nav.alerts",
      "nav.members",
      "nav.org",
      "nav.help",
      "nav.feedback",
    ],
  );
  // The bar renders visible + the "More" cell = 5, regardless of total items.
  assert.equal(visible.length + 1, 5);
});

test("Dashboard is exact-match so it only highlights on /app/dashboard", () => {
  const dash = navItemsFor({ role: "admin" }).find(
    (i) => i.href === "/app/dashboard",
  );
  assert.equal(dash?.exact, true);
});
