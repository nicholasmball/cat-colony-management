import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isLocale,
  localeFromAcceptLanguage,
  pickLocale,
  SUPPORTED_LOCALES,
} from "./locale.ts";

test("isLocale only accepts supported codes", () => {
  assert.equal(isLocale("pt"), true);
  assert.equal(isLocale("en"), true);
  assert.equal(isLocale("es"), false);
  assert.equal(isLocale(""), false);
  assert.equal(isLocale(undefined), false);
  assert.equal(isLocale(null), false);
});

test("supported locales are exactly pt + en", () => {
  assert.deepEqual([...SUPPORTED_LOCALES], ["pt", "en"]);
});

test("Accept-Language: clear English resolves to en", () => {
  assert.equal(localeFromAcceptLanguage("en-US,en;q=0.9"), "en");
  assert.equal(localeFromAcceptLanguage("en-GB"), "en");
});

test("Accept-Language: Portuguese resolves to pt", () => {
  assert.equal(localeFromAcceptLanguage("pt-PT,pt;q=0.9"), "pt");
  assert.equal(localeFromAcceptLanguage("pt-BR"), "pt");
});

test("Accept-Language: quality values pick the highest-ranked supported tag", () => {
  // English requested but Portuguese ranked higher → pt wins.
  assert.equal(localeFromAcceptLanguage("en;q=0.5,pt;q=0.9"), "pt");
  // Unsupported top choice falls through to the next supported one.
  assert.equal(localeFromAcceptLanguage("es-ES,fr;q=0.8,en;q=0.6"), "en");
});

test("Accept-Language: no supported language returns null", () => {
  assert.equal(localeFromAcceptLanguage("es-ES,fr;q=0.8"), null);
  assert.equal(localeFromAcceptLanguage(""), null);
  assert.equal(localeFromAcceptLanguage(null), null);
  assert.equal(localeFromAcceptLanguage(undefined), null);
});

test("pickLocale: a valid cookie wins over everything", () => {
  assert.equal(
    pickLocale({ cookieLocale: "en", acceptLanguage: "pt-PT" }),
    "en",
  );
  assert.equal(
    pickLocale({ cookieLocale: "pt", acceptLanguage: "en-US" }),
    "pt",
  );
});

test("pickLocale: an invalid cookie falls through to Accept-Language", () => {
  assert.equal(
    pickLocale({ cookieLocale: "xx", acceptLanguage: "en-US,en;q=0.9" }),
    "en",
  );
});

test("pickLocale: no cookie, no usable header falls back to the default (pt)", () => {
  assert.equal(pickLocale({ cookieLocale: null, acceptLanguage: null }), "pt");
  assert.equal(
    pickLocale({ cookieLocale: "", acceptLanguage: "es-ES,fr;q=0.8" }),
    "pt",
  );
});
