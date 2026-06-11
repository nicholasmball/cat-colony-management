import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";

// Create a colony through the real UI (manager-only server action) and return
// its name + detail URL. Used by specs that need a colony to act on; each call
// makes a uniquely-named one so specs stay independent.
export async function createColonyViaUI(
  page: Page,
): Promise<{ name: string; url: string }> {
  const name = `E2E Colony ${randomUUID().slice(0, 8)}`;
  await page.goto("/app/colonies/new");
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Create colony" }).click();
  // createColony redirects to the list on success.
  await page.waitForURL(/\/app\/colonies(\?|$)/);
  const link = page.getByRole("link", { name });
  await expect(link).toBeVisible();
  await link.click();
  await page.waitForURL(/\/app\/colonies\/[0-9a-f-]+/);
  return { name, url: page.url() };
}

// Add a cat to a colony so feed/incident specs have a sighting target.
export async function addCatViaUI(
  page: Page,
  colonyUrl: string,
): Promise<string> {
  const catName = `E2E Cat ${randomUUID().slice(0, 8)}`;
  await page.goto(`${colonyUrl}/cats/new`);
  // The "Name" label collides with the "Description (if it has no name)" label
  // under getByLabel (strict-mode: 2 matches). getByPlaceholder is also ambiguous
  // (case-insensitive substring: "e.g. Ginger" matches the temp_id field's
  // "e.g. ginger tom by the bins"), so target the name input by its exact
  // accessible name.
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(catName);
  // Match the submit button by its exact name — the loose /save/i regex also
  // matched the offline status button ("Online · All saved").
  await page.getByRole("button", { name: "Add cat", exact: true }).click();
  await page.waitForURL(/\/app\/colonies\/[0-9a-f-]+(\?|$)/);
  return catName;
}

// Report a NEW cat (new_unconfirmed) through the field "Report a new cat" form —
// available to every role (feeders included). Posts via fetch then redirects to
// the colony with ?reported=cat. Returns the unique name used so the caller can
// find it. The form's "Name" field accessible-name contains "Name", so match it
// by its placeholder to disambiguate from the "Description" field.
export async function reportCatViaUI(
  page: Page,
  colonyUrl: string,
): Promise<string> {
  const catName = `E2E Report ${randomUUID().slice(0, 8)}`;
  await page.goto(`${colonyUrl}/cats/report`);
  await page.getByRole("heading", { name: "Report a new cat" }).waitFor();
  await page.getByPlaceholder("e.g. Smudge").fill(catName);
  await page.getByRole("button", { name: "Report cat" }).click();
  await page.waitForURL(/\/app\/colonies\/[0-9a-f-]+\?reported=cat/);
  return catName;
}
