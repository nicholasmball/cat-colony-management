import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ── Regression guard for the "cat-photo upload is camera-only on iOS" bug ──
// Step 1 (Reproduce & Investigate) pinned the cause: the cat-photo file <input>s
// hard-coded capture="environment", which on iOS forces the native picker into
// camera-only mode and removes the Photo Library option. The fix removes that
// attribute (keeping accept="image/*") so iOS offers both Library and Camera.
//
// This is a source-guard rather than a DOM/e2e test on purpose: the project's
// unit suite is logic-only (node --test, no DOM) and runs in CI, whereas e2e
// (Playwright) runs against prod and is NOT in CI. A source-guard placed in
// lib/ is swept by `npm test`, so it actually runs on every CI gate and blocks
// a re-introduction of `capture` without adding a DOM testing dependency.

const COMPONENTS = [
  "../components/cat-report-form.tsx",
  "../components/image-upload.tsx",
  "../components/incident-form.tsx",
] as const;

for (const rel of COMPONENTS) {
  const path = fileURLToPath(new URL(rel, import.meta.url));
  const src = readFileSync(path, "utf8");

  test(`${rel}: photo input keeps accept="image/*"`, () => {
    assert.match(
      src,
      /accept="image\/\*"/,
      `${rel} should retain accept="image/*" on its photo <input>`,
    );
  });

  test(`${rel}: photo input does not force iOS camera-only via capture`, () => {
    assert.doesNotMatch(
      src,
      /\bcapture=/,
      `${rel} must not set capture=… on a file <input> — it makes iOS camera-only and hides the Photo Library`,
    );
  });
}
