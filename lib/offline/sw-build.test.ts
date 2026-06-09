import { test } from "node:test";
import assert from "node:assert/strict";
import { planBuild } from "./sw-build.ts";

// SW DISABLED by default → Turbopack (no extra args), no SW emitted.

test("planBuild: unset flag → default bundler, SW off", () => {
  const plan = planBuild(undefined);
  assert.deepEqual(plan.args, []);
  assert.equal(plan.swEnabled, false);
});

test("planBuild: 'false' → default bundler, SW off", () => {
  assert.deepEqual(planBuild("false"), { args: [], swEnabled: false });
});

test("planBuild: junk strings → SW off (strict 'true' allowlist)", () => {
  for (const v of ["1", "yes", "on", "truthy", "0", ""]) {
    assert.equal(planBuild(v).swEnabled, false, `value: ${v}`);
  }
});

// SW ENABLED (the Deploy gate) → webpack so Serwist compiles the SW.

test("planBuild: 'true' → webpack build, SW on", () => {
  const plan = planBuild("true");
  assert.deepEqual(plan.args, ["--webpack"]);
  assert.equal(plan.swEnabled, true);
});

test("planBuild: 'TRUE' / '  true  ' → webpack (case-insensitive, trimmed)", () => {
  assert.equal(planBuild("TRUE").swEnabled, true);
  assert.deepEqual(planBuild("  true  ").args, ["--webpack"]);
});
