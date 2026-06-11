import { expect, test } from "@playwright/test";

// ─────────────────────────────────────────────────────────────────────────────
// Help / quick-start (/app/help). The page is reachable for EVERY role —
// feeders most of all (they get no training) — so we exercise it under the
// feeder storageState. We assert:
//   • the Help nav link is reachable from the app shell and lands on /app/help,
//   • the page renders its key sections in real EN copy (never raw i18n keys),
//   • switching to Portuguese localises the page (the bug-class guard).
// We act in a private context for the PT flip so the locale-cookie change never
// leaks into the shared feeder session other specs reuse.
// ─────────────────────────────────────────────────────────────────────────────

test.describe("feeder reaches Help and sees the quick-start", () => {
  test.use({ storageState: "e2e/.auth/feeder.json" });

  test("the Help link in the nav lands on /app/help", async ({ page }) => {
    await page.goto("/app/today");
    // The sidebar nav (default desktop viewport) carries every role's items;
    // Help trails the list and is inline for feeders.
    const nav = page.getByRole("navigation").first();
    await nav.getByRole("link", { name: "Help" }).click();
    await page.waitForURL("**/app/help");
    await expect(
      page.getByRole("heading", { name: "Help & quick start" }),
    ).toBeVisible();
  });

  test("the page renders its key sections in real EN copy", async ({
    page,
  }) => {
    await page.goto("/app/help");

    // The four daily questions + each major section heading render real text.
    // "Was the colony fed?" appears twice (the daily-questions list AND the
    // feeding-update steps), so assert the first match rather than a unique one.
    await expect(page.getByText("Was the colony fed?").first()).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Record a feeding update/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Report a new cat/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Report an incident/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Who does what/i }),
    ).toBeVisible();

    // The roles section names all three roles, and the urgent tier is called out.
    await expect(page.getByText("Feeder", { exact: true })).toBeVisible();
    await expect(page.getByText("Caretaker", { exact: true })).toBeVisible();
    await expect(page.getByText("Urgent", { exact: true })).toBeVisible();

    // No raw namespaced i18n keys leak through (the regression bug class).
    await expect(page.getByText(/help\./)).toHaveCount(0);
    await expect(page.getByText(/\bfeeding\.step1\b/)).toHaveCount(0);
  });
});

test("Help renders in Portuguese when the locale is PT", async ({
  browser,
}) => {
  const ctx = await browser.newContext({
    storageState: "e2e/.auth/feeder.json",
  });
  const page = await ctx.newPage();
  await page.goto("/app/help");

  // Flip to PT via the EN|PT radiogroup, then assert the PT heading + copy.
  await page.getByRole("radio", { name: "Português" }).click();
  await expect(
    page.getByRole("heading", { name: "Ajuda e primeiros passos" }),
  ).toBeVisible();
  // Appears twice (daily-questions list + feeding steps) — assert the first.
  await expect(
    page.getByText("A colónia foi alimentada?").first(),
  ).toBeVisible();
  // No raw keys in PT either.
  await expect(page.getByText(/help\./)).toHaveCount(0);

  // Toggle back to EN so the session is left as found.
  await page.getByRole("radio", { name: "English" }).click();
  await expect(
    page.getByRole("heading", { name: "Help & quick start" }),
  ).toBeVisible();

  await ctx.close();
});
