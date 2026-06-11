import { test } from "node:test";
import assert from "node:assert/strict";
import { appVersion } from "./app-version.ts";

const KEY = "NEXT_PUBLIC_COMMIT_SHA";

function withEnv(value: string | undefined, fn: () => void) {
  const prev = process.env[KEY];
  if (value === undefined) delete process.env[KEY];
  else process.env[KEY] = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env[KEY];
    else process.env[KEY] = prev;
  }
}

test("appVersion returns the commit SHA when set", () => {
  withEnv("abc1234def", () => assert.equal(appVersion(), "abc1234def"));
});

test("appVersion falls back to 'dev' when unset or empty", () => {
  withEnv(undefined, () => assert.equal(appVersion(), "dev"));
  withEnv("", () => assert.equal(appVersion(), "dev"));
});
