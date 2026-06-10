import { expect, test } from "@playwright/test";
import { createColonyViaUI, reportCatViaUI } from "../helpers/ui";

// ─────────────────────────────────────────────────────────────────────────────
// Cat detail — Sighting timeline & Status history (read-only sections).
//
// The cat_status_history trigger fires on a status CHANGE (not on plain INSERT),
// so to populate the Status history section deterministically we drive a real
// transition through the UI: report a NEW cat (status new_unconfirmed) then
// confirm it as admin (→ active). That writes one history row
// (new_unconfirmed → active) the section must render. The Sighting timeline has
// no sighting in this flow, so it shows its friendly empty state — still proving
// the section, heading and explainer copy render.
//
// Resilient selectors (headings + copy), default admin storageState. Everything
// lives in the throwaway per-run org; teardown's cascade cleans up.
// ─────────────────────────────────────────────────────────────────────────────

test("cat detail renders the sighting timeline and status history sections", async ({
  page,
}) => {
  const colony = await createColonyViaUI(page);

  // Report a new cat (new_unconfirmed) — leaves us back on the colony page.
  const catName = await reportCatViaUI(page, colony.url);

  // Open the reported cat and confirm it (admin only) → a status change.
  await page.goto(colony.url);
  const catLink = page.getByRole("link", { name: new RegExp(catName) });
  await expect(catLink).toBeVisible();
  await catLink.click();
  await page.waitForURL(/\/app\/colonies\/[0-9a-f-]+\/cats\/[0-9a-f-]+/);
  const catUrl = page.url().split(/[?#]/)[0];

  await page.getByRole("button", { name: "Confirm cat" }).click();
  // Confirm redirects back to the cat detail; re-open to be safe.
  await page.goto(catUrl);

  // Both section headings render.
  await expect(
    page.getByRole("heading", { name: "Sighting timeline" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Status history" }),
  ).toBeVisible();

  // Status history shows the confirm transition: New · unconfirmed → Active.
  // Scope to the status-history section and match the resulting Active pill.
  const statusHistory = page
    .getByRole("heading", { name: "Status history" })
    .locator("xpath=..");
  await expect(
    statusHistory.getByText("Active", { exact: true }),
  ).toBeVisible();
  await expect(statusHistory.getByText("New · unconfirmed")).toBeVisible();

  // Sighting timeline renders its section — empty state here (no sighting yet).
  await expect(page.getByText("No sightings recorded yet")).toBeVisible();
});
