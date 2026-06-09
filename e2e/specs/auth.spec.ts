import { expect, test } from "@playwright/test";

// The admin storageState (config default) is a real signed-in session.
test("saved session loads the app authenticated", async ({ page }) => {
  await page.goto("/app");
  // Not bounced to login → authenticated. The app landing resolves the active
  // org (the throwaway org, the user's only membership).
  await expect(page).toHaveURL(/\/app(\/|$|\?)/);
  await page.goto("/app/colonies");
  await expect(page).toHaveURL(/\/app\/colonies/);
  await expect(page.getByRole("heading", { name: "Colonies" })).toBeVisible();
});

// A fresh context with no session must be redirected to login.
test("unauthenticated visitor is redirected to /login", async ({ browser }) => {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await context.close();
});
