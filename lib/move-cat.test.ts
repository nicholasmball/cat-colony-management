import { test } from "node:test";
import assert from "node:assert/strict";
import { canMoveCat } from "./move-cat.ts";

const colonies = [{ id: "a" }, { id: "b" }, { id: "c" }];

test("canMoveCat: a different live colony in the org → ok", () => {
  assert.deepEqual(canMoveCat("b", "a", colonies), { ok: true });
});

test("canMoveCat: missing/blank target → missing", () => {
  assert.deepEqual(canMoveCat(undefined, "a", colonies), {
    ok: false,
    reason: "missing",
  });
  assert.deepEqual(canMoveCat(null, "a", colonies), {
    ok: false,
    reason: "missing",
  });
  assert.deepEqual(canMoveCat("   ", "a", colonies), {
    ok: false,
    reason: "missing",
  });
});

test("canMoveCat: same as the current colony → same", () => {
  assert.deepEqual(canMoveCat("a", "a", colonies), {
    ok: false,
    reason: "same",
  });
});

test("canMoveCat: target not among the org's colonies → notFound", () => {
  // Models a cross-org / deleted / non-existent colony id: the caller only ever
  // passes its own live colonies, so anything else is rejected.
  assert.deepEqual(canMoveCat("z", "a", colonies), {
    ok: false,
    reason: "notFound",
  });
  assert.deepEqual(canMoveCat("b", "a", []), {
    ok: false,
    reason: "notFound",
  });
});

test("canMoveCat: trims the target before matching", () => {
  assert.deepEqual(canMoveCat(" b ", "a", colonies), { ok: true });
});
