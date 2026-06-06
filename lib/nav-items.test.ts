import { test } from "node:test";
import assert from "node:assert/strict";
import { navItemsFor } from "./nav-items.ts";

const labels = (role?: string | null) =>
  navItemsFor({ role }).map((i) => i.label);

test("feeder omits Home, leading with Today", () => {
  const ls = labels("feeder");
  assert.deepEqual(ls, ["Today", "Colonies"]);
  assert.equal(ls[0], "Today");
  assert.ok(!ls.includes("Home"));
});

test("caretaker keeps Home but gets no admin items", () => {
  const ls = labels("caretaker");
  assert.deepEqual(ls, ["Home", "Today", "Colonies"]);
  assert.ok(!ls.includes("Members"));
  assert.ok(!ls.includes("Organisation"));
});

test("admin keeps Home and gets Members + Organisation", () => {
  const ls = labels("admin");
  assert.deepEqual(ls, [
    "Home",
    "Today",
    "Colonies",
    "Members",
    "Organisation",
  ]);
});

test("unknown/undefined role is treated as a feeder (no Home)", () => {
  assert.deepEqual(labels(undefined), ["Today", "Colonies"]);
  assert.deepEqual(labels(null), ["Today", "Colonies"]);
  assert.deepEqual(labels("stranger"), ["Today", "Colonies"]);
});

test("Home is exact-match so it only highlights on /app", () => {
  const home = navItemsFor({ role: "admin" }).find((i) => i.href === "/app");
  assert.equal(home?.exact, true);
});
