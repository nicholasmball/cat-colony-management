import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

// Create a colony via the UI → it appears in the list AND its detail page.
test("create a colony via the UI; it shows in the list and detail", async ({
  page,
}) => {
  const name = `E2E Colony ${randomUUID().slice(0, 8)}`;

  await page.goto("/app/colonies/new");
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Create colony" }).click();

  // createColony redirects to the list on success.
  await page.waitForURL(/\/app\/colonies(\?|$)/);
  const listLink = page.getByRole("link", { name });
  await expect(listLink).toBeVisible();

  // Detail page renders the colony's name.
  await listLink.click();
  await page.waitForURL(/\/app\/colonies\/[0-9a-f-]+/);
  await expect(page.getByRole("heading", { name })).toBeVisible();
});
