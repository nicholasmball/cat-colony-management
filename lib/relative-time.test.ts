import { test } from "node:test";
import assert from "node:assert/strict";
import { relativeTime } from "./relative-time.ts";

const now = new Date("2026-06-09T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test("under a minute collapses to 'now' (en)", () => {
  assert.equal(relativeTime(ago(5 * SEC), now, "en"), "now");
  assert.equal(relativeTime(ago(59 * SEC), now, "en"), "now");
});

test("minutes ago (en, numeric auto)", () => {
  assert.equal(relativeTime(ago(2 * MIN), now, "en"), "2 minutes ago");
  assert.equal(relativeTime(ago(1 * MIN), now, "en"), "1 minute ago");
});

test("hours ago (en)", () => {
  assert.equal(relativeTime(ago(3 * HOUR), now, "en"), "3 hours ago");
});

test("days ago uses 'yesterday' for one day (numeric auto)", () => {
  assert.equal(relativeTime(ago(1 * DAY), now, "en"), "yesterday");
  assert.equal(relativeTime(ago(3 * DAY), now, "en"), "3 days ago");
});

test("picks the coarsest fitting unit (weeks, then months, then years)", () => {
  assert.equal(relativeTime(ago(8 * DAY), now, "en"), "last week");
  assert.equal(relativeTime(ago(40 * DAY), now, "en"), "last month");
  assert.equal(relativeTime(ago(400 * DAY), now, "en"), "last year");
});

test("locale-aware: pt renders Portuguese wording", () => {
  // We assert it differs from English rather than pinning exact ICU output,
  // which can vary by ICU version — the point is the locale flows through.
  const en = relativeTime(ago(2 * HOUR), now, "en");
  const pt = relativeTime(ago(2 * HOUR), now, "pt");
  assert.equal(en, "2 hours ago");
  assert.notEqual(pt, en);
  assert.ok(/2/.test(pt));
});

test("future times read as 'in …' (clock skew beyond a minute)", () => {
  const future = new Date(now.getTime() + 5 * MIN);
  assert.equal(relativeTime(future, now, "en"), "in 5 minutes");
});

test("tiny future skew under a minute still reads 'now'", () => {
  const future = new Date(now.getTime() + 10 * SEC);
  assert.equal(relativeTime(future, now, "en"), "now");
});
