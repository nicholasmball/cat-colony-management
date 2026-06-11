import { expect, test } from "@playwright/test";
import { readRunState, serviceClient } from "../helpers/admin";

// ─────────────────────────────────────────────────────────────────────────────
// Organisation settings (/app/org, ADMIN-ONLY). The members/erase specs cover
// who's locked OUT; this covers the actual edit form, which nothing else does:
//   • admin edits name + notes + timezone → persists on reload AND in the DB,
//   • a blank name is rejected with the localized error (server re-validation,
//     not just the native required attribute),
//   • an invalid timezone is rejected with the localized error,
//   • a caretaker is bounced (admin-only, even though they're a manager).
//
// Mutates the single test org's organisations row; teardown's cascade drops it
// with the org. We restore the org name afterwards so the run-state name stays
// truthful for any later spec that reads it. Default storageState is admin.
// ─────────────────────────────────────────────────────────────────────────────

test("admin edits org name, notes and timezone; persists on reload + in the DB", async ({
  page,
}) => {
  const { orgId, orgName } = readRunState();
  const svc = serviceClient();

  const newName = `${orgName} ✎`;
  const newNotes = `E2E notes ${Date.now()}`;
  const newZone = "Europe/London";

  await page.goto("/app/org");
  await expect(
    page.getByRole("heading", { name: "Organisation" }),
  ).toBeVisible();

  await page.locator('input[name="name"]').fill(newName);
  await page.locator('textarea[name="notes"]').fill(newNotes);
  await page.locator('select[name="timezone"]').selectOption(newZone);
  await page.getByRole("button", { name: "Save changes" }).click();

  // Saved → redirect with the flag + the "✓ Saved." confirmation banner. Match
  // the exact banner text — the sidebar sync indicator also says "All saved".
  await page.waitForURL(/\/app\/org\?saved=1/);
  await expect(page.getByText("✓ Saved.", { exact: true })).toBeVisible();

  // Values survive a reload.
  await page.goto("/app/org");
  await expect(page.locator('input[name="name"]')).toHaveValue(newName);
  await expect(page.locator('textarea[name="notes"]')).toHaveValue(newNotes);
  await expect(page.locator('select[name="timezone"]')).toHaveValue(newZone);

  // DB reflects all three, scoped to the test org.
  const { data } = await svc
    .from("organisations")
    .select("name, notes, timezone")
    .eq("id", orgId!)
    .single();
  expect(data?.name).toBe(newName);
  expect(data?.notes).toBe(newNotes);
  expect(data?.timezone).toBe(newZone);

  // Restore the original name so run-state stays truthful for later specs.
  await svc.from("organisations").update({ name: orgName }).eq("id", orgId!);
});

test("a blank name is rejected with a localized error", async ({ page }) => {
  await page.goto("/app/org");

  // Drop the native `required` so the browser submits the empty value and the
  // SERVER re-validation (the real guard) fires.
  const name = page.locator('input[name="name"]');
  await name.evaluate((el) => el.removeAttribute("required"));
  await name.fill("");
  await page.getByRole("button", { name: "Save changes" }).click();

  await page.waitForURL(/\/app\/org\?error=/);
  const alert = page.getByRole("alert").filter({ hasText: /\S/ });
  await expect(alert.first()).toBeVisible();
  await expect(alert.first()).toContainText("name is required");
  // Never a raw i18n key.
  await expect(alert.first()).not.toContainText("errors.");
});

test("an invalid timezone is rejected with a localized error", async ({
  page,
}) => {
  await page.goto("/app/org");

  // The <select> only offers real zones, so inject a bogus option value and
  // pick it to drive the server-side isValidTimeZone guard.
  const tz = page.locator('select[name="timezone"]');
  await tz.evaluate((el: HTMLSelectElement) => {
    const opt = document.createElement("option");
    opt.value = "Mars/Phobos";
    opt.textContent = "Mars/Phobos";
    el.appendChild(opt);
    el.value = "Mars/Phobos";
  });
  await page.getByRole("button", { name: "Save changes" }).click();

  await page.waitForURL(/\/app\/org\?error=/);
  const alert = page.getByRole("alert").filter({ hasText: /\S/ });
  await expect(alert.first()).toBeVisible();
  await expect(alert.first()).toContainText("valid timezone");
  await expect(alert.first()).not.toContainText("errors.");
});

test("a caretaker is bounced from /app/org (admin-only)", async ({
  browser,
}) => {
  const ctx = await browser.newContext({
    storageState: "e2e/.auth/caretaker.json",
  });
  const page = await ctx.newPage();
  await page.goto("/app/org");
  await expect(page).not.toHaveURL(/\/app\/org/);
  await ctx.close();
});
