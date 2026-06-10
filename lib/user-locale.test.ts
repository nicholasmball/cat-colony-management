import { test } from "node:test";
import assert from "node:assert/strict";
import { localeFromUserMetadata } from "./user-locale.ts";

test("returns a valid stored locale", () => {
  assert.equal(localeFromUserMetadata({ locale: "en" }), "en");
  assert.equal(localeFromUserMetadata({ locale: "pt" }), "pt");
});

test("returns null for missing / invalid / non-string", () => {
  assert.equal(localeFromUserMetadata({}), null);
  assert.equal(localeFromUserMetadata(null), null);
  assert.equal(localeFromUserMetadata(undefined), null);
  assert.equal(localeFromUserMetadata({ locale: "fr" }), null);
  assert.equal(localeFromUserMetadata({ locale: 42 }), null);
});
