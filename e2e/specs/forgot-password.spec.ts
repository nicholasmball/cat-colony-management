import { expect, test } from "@playwright/test";

// ─────────────────────────────────────────────────────────────────────────────
// Forgot-password — step 1 of the reset flow (request a reset link). This is the
// only auth flow not exercised by the suite, and it's invite-only-account-safe:
//   • the "Forgot password?" link on /login lands on /forgot-password,
//   • submitting an email ALWAYS shows the same existence-safe confirmation
//     (?sent=1) — it never leaks whether the address is registered,
//   • the same is true for an address that cannot exist (a .invalid TLD),
//   • the page localises to Portuguese (the raw-i18n-key regression guard).
//
// We DON'T assert the recovery email is delivered — real SMTP delivery is owned
// by Supabase Auth and is not e2e-testable headlessly (listed in COVERAGE.md).
// No org state is touched, so nothing to tear down. Unauthenticated contexts.
// ─────────────────────────────────────────────────────────────────────────────

test.use({ storageState: { cookies: [], origins: [] } });

test("the Forgot password link on /login lands on the reset-request page", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await page.waitForURL(/\/forgot-password(\?|$)/);
  await expect(
    page.getByRole("heading", { name: "Reset your password" }),
  ).toBeVisible();
  // The email field + submit are present, and a back-link to sign-in is offered.
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send reset link" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Back to sign in" }),
  ).toBeVisible();
});

test("submitting any email shows the existence-safe confirmation", async ({
  page,
}) => {
  // A .invalid address can never be a real account — the response must be the
  // SAME generic confirmation regardless, proving the flow never leaks which
  // emails are registered.
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill("e2e+forgot@scot-e2e.invalid");
  await page.getByRole("button", { name: "Send reset link" }).click();

  await page.waitForURL(/\/forgot-password\?sent=1/);
  // The confirmation is rendered as a role=status banner with the generic copy.
  const status = page.getByRole("status").filter({ hasText: /reset/i });
  await expect(status).toBeVisible();
  await expect(status).toContainText("If that email exists");
  // It NEVER reveals the address state, and never leaks a raw i18n key.
  await expect(page.getByText(/auth\.reset/)).toHaveCount(0);
  // A back-to-sign-in link is offered from the confirmation.
  await expect(
    page.getByRole("link", { name: "Back to sign in" }),
  ).toBeVisible();
});

test("the reset-request page localises to Portuguese", async ({ browser }) => {
  // Private context with a PT locale cookie so no shared session is disturbed.
  const baseURL = "https://cat-colony-management.vercel.app";
  const ctx = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  await ctx.addCookies([{ name: "locale", value: "pt", url: baseURL }]);
  const page = await ctx.newPage();
  await page.goto("/forgot-password");

  // The PT heading renders — not a raw key.
  await expect(
    page.getByRole("heading", { name: "Repor a palavra-passe" }),
  ).toBeVisible();
  await expect(page.getByText(/auth\.reset/)).toHaveCount(0);

  await ctx.close();
});
