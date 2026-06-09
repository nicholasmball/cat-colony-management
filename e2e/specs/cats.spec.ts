import { expect, test } from "@playwright/test";
import { readRunState, serviceClient } from "../helpers/admin";
import { createColonyViaUI, reportCatViaUI } from "../helpers/ui";

// ─────────────────────────────────────────────────────────────────────────────
// Cat lifecycle: a feeder reports a new cat (new_unconfirmed) → a manager sees it
// in the colony's review queue and confirms it (→ active); a second report is
// rejected as a duplicate; a manager edits a cat's details; the cat detail shows
// status. Everything lives inside the throwaway org (teardown's cascade covers
// the cat rows). Default storageState is admin; the feeder uses its own context.
// ─────────────────────────────────────────────────────────────────────────────

const UNCONFIRMED = "new_unconfirmed";

test("feeder reports a cat; admin confirms it to active", async ({
  page,
  browser,
}) => {
  // Admin creates the colony.
  const { url } = await createColonyViaUI(page);
  const colonyId = url.split("/app/colonies/")[1]?.split(/[?#]/)[0];
  expect(colonyId).toBeTruthy();

  // Feeder reports a new cat into that colony (its own session/context).
  const feederCtx = await browser.newContext({
    storageState: "e2e/.auth/feeder.json",
  });
  const feederPage = await feederCtx.newPage();
  const catName = await reportCatViaUI(feederPage, url);
  await feederCtx.close();

  // It persisted as new_unconfirmed in the test org + this colony.
  const { orgId } = readRunState();
  const svc = serviceClient();
  const { data: reported } = await svc
    .from("cats")
    .select("id, name, status")
    .eq("organisation_id", orgId!)
    .eq("colony_id", colonyId!)
    .eq("name", catName);
  expect(reported?.length).toBe(1);
  const catId = reported![0].id as string;
  expect(reported![0].status).toBe(UNCONFIRMED);

  // Admin sees it flagged on the colony page (★ New · unconfirmed) and opens it.
  await page.goto(url);
  await expect(
    page.getByRole("link", { name: new RegExp(catName) }),
  ).toBeVisible();

  await page.goto(`${url}/cats/${catId}`);
  await expect(page.getByRole("heading", { name: catName })).toBeVisible();
  await expect(page.getByText("New · unconfirmed")).toBeVisible();

  // Confirm it → active.
  await page.getByRole("button", { name: "Confirm cat" }).click();
  await page.waitForURL(/\/app\/colonies\/[0-9a-f-]+\?confirmed=cat/);
  await expect(page.getByText("Cat confirmed", { exact: false })).toBeVisible();

  const { data: after } = await svc
    .from("cats")
    .select("status, confirmed_by")
    .eq("id", catId)
    .single();
  expect(after?.status).toBe("active");
  expect(after?.confirmed_by).not.toBeNull();
});

test("admin rejects a reported cat as a duplicate", async ({
  page,
  browser,
}) => {
  const { url } = await createColonyViaUI(page);
  const colonyId = url.split("/app/colonies/")[1]?.split(/[?#]/)[0];

  const feederCtx = await browser.newContext({
    storageState: "e2e/.auth/feeder.json",
  });
  const feederPage = await feederCtx.newPage();
  const catName = await reportCatViaUI(feederPage, url);
  await feederCtx.close();

  const { orgId } = readRunState();
  const svc = serviceClient();
  const { data: reported } = await svc
    .from("cats")
    .select("id")
    .eq("organisation_id", orgId!)
    .eq("colony_id", colonyId!)
    .eq("name", catName);
  const catId = reported![0].id as string;

  // Reject: a ConfirmButton that swaps to a confirm "Reject" before posting.
  await page.goto(`${url}/cats/${catId}`);
  await page.getByRole("button", { name: "Reject…" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Reject", exact: true })
    .click();
  await page.waitForURL(/\/app\/colonies\/[0-9a-f-]+\?rejected=cat/);

  // Reject soft-deletes the cat: it no longer appears in the active set.
  const { data: afterActive } = await svc
    .from("cats")
    .select("id")
    .eq("id", catId)
    .is("deleted_at", null);
  expect(afterActive?.length).toBe(0);
});

test("admin edits a confirmed cat's details", async ({ page }) => {
  const { url } = await createColonyViaUI(page);

  // Add a cat via the manager full form (lands active-ish; we only need a record).
  const catName = `E2E EditCat ${Date.now()}`;
  await page.goto(`${url}/cats/new`);
  await page.getByLabel("Name", { exact: true }).fill(catName);
  await page.getByRole("button", { name: "Add cat" }).click();
  await page.waitForURL(/\/app\/colonies\/[0-9a-f-]+(\?|$)/);

  const catLink = page.getByRole("link", { name: new RegExp(catName) });
  await expect(catLink).toBeVisible();
  await catLink.click();
  await page.waitForURL(/\/app\/colonies\/[0-9a-f-]+\/cats\/[0-9a-f-]+/);

  // Edit → set a colour; it shows on the detail page afterwards.
  await page.getByRole("link", { name: "Edit" }).click();
  await page.waitForURL(/\/cats\/[0-9a-f-]+\/edit/);
  await page.getByLabel("Colour", { exact: true }).fill("Tabby grey");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(/\/app\/colonies\/[0-9a-f-]+(\?|$)/);

  // The colour now renders on the cat detail page.
  await catLink.click();
  await expect(page.getByText("Tabby grey")).toBeVisible();
});
