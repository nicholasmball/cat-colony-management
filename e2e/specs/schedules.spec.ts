import { expect, test } from "@playwright/test";
import { readRunState, serviceClient } from "../helpers/admin";
import { createColonyViaUI } from "../helpers/ui";

// ─────────────────────────────────────────────────────────────────────────────
// Feeding schedules. A manager (admin) creates a recurring multi-weekday schedule
// and a one-off date schedule on a colony, assigned to the feeder. We then assert:
//   • both rows persist (service-role read scoped to the test org),
//   • the feeder's Today surfaces the assigned colony,
//   • soft-deleting a schedule removes it from the colony's schedule list.
// All rows live in the throwaway org; teardown's cascade cleans them up.
//
// The recurring schedule toggles ALL seven weekday buttons so it always matches
// "today" in the org timezone — that's what makes the feeder's Today show it
// deterministically regardless of the day the suite runs.
// ─────────────────────────────────────────────────────────────────────────────

test("manager creates recurring + one-off schedules; feeder Today shows the colony; delete removes one", async ({
  page,
  browser,
}) => {
  const { name: colonyName, url } = await createColonyViaUI(page);
  const colonyId = url.split("/app/colonies/")[1]?.split(/[?#]/)[0];
  expect(colonyId).toBeTruthy();

  // ── Recurring (all 7 weekdays) → guaranteed to match today ──
  await page.goto(`${url}/schedules/new`);
  await expect(
    page.getByRole("heading", { name: "Add schedule" }),
  ).toBeVisible();
  // Feeder is the only assignable non-self member besides caretaker; pick it by
  // selecting the .invalid e2e feeder email. Just take the first option that
  // isn't the caretaker is brittle; instead select the option whose value is the
  // feeder's id (resolved from run-state).
  const { orgId, users } = readRunState();
  const feeder = users.find((u) => u.role === "feeder")!;
  await page.getByLabel("Feeder").selectOption(feeder.id);
  // Weekly is the default type; toggle every weekday button (aria-pressed group).
  const dayButtons = page
    .getByRole("group", { name: "Repeats on" })
    .getByRole("button");
  const count = await dayButtons.count();
  for (let i = 0; i < count; i++) await dayButtons.nth(i).click();
  await page.getByRole("button", { name: "Save schedule" }).click();
  await page.waitForURL(/\/app\/colonies\/[0-9a-f-]+(\?|$)/);

  // ── One-off for today's date ──
  const today = new Date().toISOString().slice(0, 10);
  await page.goto(`${url}/schedules/new`);
  await page.getByLabel("Feeder").selectOption(feeder.id);
  await page.getByRole("button", { name: /One-off/ }).click();
  await page.getByLabel("Date").fill(today);
  await page.getByRole("button", { name: "Save schedule" }).click();
  await page.waitForURL(/\/app\/colonies\/[0-9a-f-]+(\?|$)/);

  // Persistence: 7 weekly rows + 1 one-off = 8 active schedule rows.
  const svc = serviceClient();
  const { data: rows } = await svc
    .from("feeding_schedules")
    .select("id, weekday, specific_date")
    .eq("organisation_id", orgId!)
    .eq("colony_id", colonyId!)
    .is("deleted_at", null);
  expect(rows?.length).toBe(8);
  expect(rows?.filter((r) => r.specific_date !== null).length).toBe(1);
  expect(rows?.filter((r) => r.weekday !== null).length).toBe(7);

  // ── Feeder's Today shows ONLY their assigned colony ──
  const feederCtx = await browser.newContext({
    storageState: "e2e/.auth/feeder.json",
  });
  const feederPage = await feederCtx.newPage();
  await feederPage.goto("/app/today");
  await expect(
    feederPage.getByRole("link", { name: new RegExp(colonyName) }),
  ).toBeVisible();
  await feederCtx.close();

  // ── Soft-delete the one-off schedule from the colony page ──
  await page.goto(url);
  // The one-off row carries the "one-off" pill (lowercase source text); delete
  // its row's Delete button.
  const oneOffRow = page
    .locator("li")
    .filter({ hasText: "one-off" })
    .filter({ hasText: feeder.email });
  await oneOffRow.first().getByRole("button", { name: "Delete" }).click();
  // ConfirmButton opens an alertdialog whose confirm button is labelled "Confirm".
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Confirm" })
    .click();
  // The action redirects back to THIS colony page — we're already here, so
  // waitForURL resolves instantly and would race the write. Wait for the heading
  // count to drop to (7) instead, then confirm the DB soft-delete.
  await expect(
    page.getByRole("heading", { name: "Feeding schedule (7)" }),
  ).toBeVisible();

  await expect
    .poll(async () => {
      const { data } = await svc
        .from("feeding_schedules")
        .select("id")
        .eq("organisation_id", orgId!)
        .eq("colony_id", colonyId!)
        .is("deleted_at", null);
      return data?.length ?? 0;
    })
    .toBe(7);
});
