import { expect, test } from "@playwright/test";
import { createColonyViaUI, reportCatViaUI } from "../helpers/ui";

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard (admin/caretaker). It surfaces the four daily questions. We seed a
// little org state (a colony with a fed update, a reported new cat, an urgent
// incident) then assert the dashboard renders the four sections and reflects
// that state — without depending on other specs (each datum is created here).
// Default storageState is admin.
// ─────────────────────────────────────────────────────────────────────────────

test("dashboard shows the four daily surfaces reflecting org state", async ({
  page,
  browser,
}) => {
  // A colony + a "fed" update so Today's-feeds has a fed count.
  const { name: colonyName, url } = await createColonyViaUI(page);
  await page.goto(`${url}/feed`);
  await page.getByRole("button", { name: "Save update" }).click();
  await page.waitForURL(/\/app\/colonies\/[0-9a-f-]+\?updated=1/);

  // A reported new cat (the New cat reports section).
  const feederCtx = await browser.newContext({
    storageState: "e2e/.auth/feeder.json",
  });
  const feederPage = await feederCtx.newPage();
  const catName = await reportCatViaUI(feederPage, url);

  // An urgent incident (the Urgent incidents section).
  await feederPage.goto(`${url}/incidents/new`);
  await feederPage.getByRole("radio", { name: "Poisoning" }).click();
  await feederPage.getByRole("radio", { name: "Urgent", exact: true }).click();
  await feederPage.getByRole("button", { name: /report/i }).click();
  await feederPage.waitForURL(/\/app\/colonies\/[0-9a-f-]+\?reported=urgent/);
  await feederCtx.close();

  // ── Dashboard renders all four daily surfaces ──
  await page.goto("/app/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Today's feeds" }),
  ).toBeVisible();
  // Headings are case-folded uppercase in CSS but the accessible text is the
  // source string; match on the real copy.
  await expect(
    page.getByText("Urgent incidents", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("New cat reports", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Cats not seen / concern", { exact: false }),
  ).toBeVisible();

  // …and the seeded state is reflected: the new cat + the urgent incident link
  // through the dashboard cards.
  await expect(page.getByText(catName)).toBeVisible();
  // The urgent incidents card shows the incident type (Poisoning) for our row.
  await expect(page.getByText("Poisoning").first()).toBeVisible();

  // The Today's-feeds summary registers at least one fed colony (our colony).
  await page.goto("/app/today");
  await expect(
    page.getByRole("link", { name: new RegExp(colonyName) }),
  ).toBeVisible();
});
