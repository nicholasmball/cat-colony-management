import { test } from "node:test";
import assert from "node:assert/strict";
import { renderInvite } from "./templates/invite.ts";
import { renderDailyDigest } from "./templates/daily-digest.ts";
import { escapeHtml } from "./templates/layout.ts";

test("invite renders subject/html/text with the org name + accept url", () => {
  const out = renderInvite("en", {
    acceptUrl: "https://app.example.org/accept?token=xyz",
    orgName: "Street Cats of Tavira",
    role: "caretaker",
  });
  assert.ok(out.subject.includes("Street Cats of Tavira"));
  assert.ok(out.html.includes("https://app.example.org/accept?token=xyz"));
  assert.ok(out.html.includes('lang="en"'));
  assert.ok(out.text.includes("https://app.example.org/accept?token=xyz"));
  assert.ok(!out.text.includes("<"), "text part has no markup");
});

test("invite renders in Portuguese when locale is pt", () => {
  const en = renderInvite("en", {
    acceptUrl: "https://x",
    orgName: "Org",
    role: "feeder",
  });
  const pt = renderInvite("pt", {
    acceptUrl: "https://x",
    orgName: "Org",
    role: "feeder",
  });
  assert.notEqual(en.subject, pt.subject, "subject differs by locale");
  assert.ok(pt.html.includes('lang="pt"'));
});

test("digest summarises the item count and lists titles", () => {
  const out = renderDailyDigest("en", {
    appUrl: "https://app.example.org/app/notifications",
    orgName: "Org",
    itemTitles: ["Feeding missed: North Beach", "Cat not seen: Tom"],
  });
  assert.ok(out.html.includes("Feeding missed: North Beach"));
  assert.ok(out.html.includes("Cat not seen: Tom"));
  assert.ok(out.html.includes("https://app.example.org/app/notifications"));
  assert.ok(out.text.includes("- Feeding missed: North Beach"));
});

test("escapeHtml neutralises injected markup in interpolated values", () => {
  const out = renderInvite("en", {
    acceptUrl: "https://x",
    orgName: "<script>alert(1)</script>",
    role: "feeder",
  });
  assert.ok(!out.html.includes("<script>"), "org name must be escaped");
  assert.ok(out.html.includes("&lt;script&gt;"));
});

test("escapeHtml escapes the five significant chars", () => {
  assert.equal(escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
});
