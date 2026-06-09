import { test } from "node:test";
import assert from "node:assert/strict";
import { swMode, envFlag } from "./sw-flags.ts";

// ── swMode: the full truth table ──────────────────────────────────────────────
// kill ALWAYS wins; then enabled; then off. Four combinations, exhaustively.

test("swMode: kill + enabled → kill (kill always wins)", () => {
  assert.equal(swMode({ enabled: true, kill: true }), "kill");
});

test("swMode: kill only → kill", () => {
  assert.equal(swMode({ enabled: false, kill: true }), "kill");
});

test("swMode: enabled only → register", () => {
  assert.equal(swMode({ enabled: true, kill: false }), "register");
});

test("swMode: neither → off", () => {
  assert.equal(swMode({ enabled: false, kill: false }), "off");
});

// ── envFlag: the string→boolean coercion contract ─────────────────────────────
// Only the exact string "true" (trimmed, case-insensitive) is true.

test("envFlag: exact 'true' is true", () => {
  assert.equal(envFlag("true"), true);
});

test("envFlag: case-insensitive and trimmed", () => {
  assert.equal(envFlag("TRUE"), true);
  assert.equal(envFlag("True"), true);
  assert.equal(envFlag("  true  "), true);
});

test("envFlag: undefined is false (unset env var)", () => {
  assert.equal(envFlag(undefined), false);
});

test("envFlag: empty string is false", () => {
  assert.equal(envFlag(""), false);
});

test("envFlag: 'false' is false", () => {
  assert.equal(envFlag("false"), false);
});

test("envFlag: other truthy-looking strings are false (strict allowlist)", () => {
  assert.equal(envFlag("1"), false);
  assert.equal(envFlag("yes"), false);
  assert.equal(envFlag("on"), false);
  assert.equal(envFlag("0"), false);
  assert.equal(envFlag("truthy"), false);
});

// ── envFlag + swMode composed: how real env vars drive the mode ───────────────
// This mirrors exactly what components/sw-register.tsx computes.

test("composed: NEXT_PUBLIC_SW_KILL='true' forces kill regardless of enabled", () => {
  assert.equal(
    swMode({ enabled: envFlag("true"), kill: envFlag("true") }),
    "kill",
  );
  assert.equal(
    swMode({ enabled: envFlag("false"), kill: envFlag("true") }),
    "kill",
  );
});

test("composed: only SW_ENABLED='true' → register", () => {
  assert.equal(
    swMode({ enabled: envFlag("true"), kill: envFlag(undefined) }),
    "register",
  );
});

test("composed: both unset → off (default in dev/preview/prod for Phase 0)", () => {
  assert.equal(
    swMode({ enabled: envFlag(undefined), kill: envFlag(undefined) }),
    "off",
  );
});
