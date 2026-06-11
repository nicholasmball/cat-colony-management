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

test("emails carry the canonical SCoT chrome (logo, kicker, indigo button, footer)", () => {
  const out = renderInvite("en", {
    acceptUrl: "https://app.example.org/accept?token=xyz",
    orgName: "Street Cats of Tavira",
    role: "caretaker",
  });
  assert.ok(
    out.html.includes("https://cat-colony-management.vercel.app/icon-192.png"),
    "logo present",
  );
  assert.ok(
    out.html.includes("text-transform:uppercase"),
    "uppercase brand kicker present",
  );
  assert.ok(out.html.includes("background:#4f46e5"), "indigo button present");
  assert.ok(out.html.includes("background:#f7f4f2"), "cream backdrop present");
  assert.ok(
    out.html.includes("Street Cats of Tavira · gestão de colónias 🐾"),
    "footer tagline present",
  );
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

// The members action passes the raw lowercase role enum; the template must
// render the localized, capitalized members.role.* label — never the raw word.
const roleLabels = {
  en: { admin: "Admin", caretaker: "Caretaker", feeder: "Feeder" },
  pt: { admin: "Administrador", caretaker: "Cuidador", feeder: "Alimentador" },
} as const;

for (const locale of ["en", "pt"] as const) {
  for (const role of ["admin", "caretaker", "feeder"] as const) {
    test(`invite (${locale}/${role}) renders the localized role label, not the raw enum`, () => {
      const out = renderInvite(locale, {
        acceptUrl: "https://app.example.org/accept?token=xyz",
        orgName: "Street Cats of Tavira",
        role,
      });
      const label = roleLabels[locale][role];
      assert.ok(
        out.html.includes(label),
        `html should contain localized label "${label}"`,
      );
      assert.ok(
        out.text.includes(label),
        `text should contain localized label "${label}"`,
      );
      // The raw lowercase enum must not leak into the rendered body.
      assert.ok(
        !out.text.includes(`as ${role}`),
        `text must not contain the raw enum "${role}"`,
      );
      assert.ok(
        !out.text.includes(`como ${role}`),
        `text must not contain the raw enum "${role}"`,
      );
    });
  }
}

test("invite EN no longer emits the 'as a {role}' article grammar bug", () => {
  const out = renderInvite("en", {
    acceptUrl: "https://x",
    orgName: "Org",
    role: "admin",
  });
  assert.ok(
    !out.text.includes("as a Admin"),
    "the broken 'as a Admin' grammar must be gone",
  );
  assert.ok(out.text.includes("as Admin"), "reads 'as Admin'");
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
