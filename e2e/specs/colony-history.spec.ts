import { expect, test, type Page } from "@playwright/test";
import { createColonyViaUI } from "../helpers/ui";

// ─────────────────────────────────────────────────────────────────────────────
// Colony detail — Recent feeding updates, Recent incidents & the Last-fed
// indicator (read-only history sections, mirroring cat-history).
//
// A fresh colony proves both empty states + "Not fed yet". We then record a
// feeding update (the feed flow) and report an incident (the report flow), and
// assert the colony page surfaces both timelines and that Last-fed reflects the
// update. The colony page is served through the SWR/SW cache, so after each
// write we re-navigate and poll (expect.toPass) instead of trusting the first
// paint — the same tolerance cat-move / cat-history specs use.
//
// Resilient selectors (headings + copy), default admin storageState, throwaway
// per-run org (teardown's cascade cleans up).
// ─────────────────────────────────────────────────────────────────────────────

// Re-open the colony page until the awaited assertion holds — absorbs the SWR
// cache serving a pre-write snapshot on the first navigation.
async function reopenUntil(
  page: Page,
  url: string,
  assertion: () => Promise<void>,
): Promise<void> {
  await expect(async () => {
    await page.goto(url);
    await assertion();
  }).toPass({ timeout: 15_000 });
}

test("colony detail shows empty history states on a fresh colony", async ({
  page,
}) => {
  await createColonyViaUI(page);

  // Both history sections render with their friendly empty states.
  await expect(
    page.getByRole("heading", { name: "Recent feeding updates" }),
  ).toBeVisible();
  await expect(page.getByText("No feeding updates yet")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Recent incidents" }),
  ).toBeVisible();
  await expect(page.getByText("No incidents", { exact: true })).toBeVisible();

  // No feeding yet → the header shows the "Not fed yet" indicator.
  await expect(page.getByText("Not fed yet")).toBeVisible();
});

test("colony detail surfaces a feeding update, last-fed and an incident", async ({
  page,
}) => {
  const { url } = await createColonyViaUI(page);

  // ── Record a feeding update ("✓ Fed" is the default) ──
  await page.goto(`${url}/feed`);
  await expect(
    page.getByRole("heading", { name: "Feeding update" }),
  ).toBeVisible();
  await expect(page.getByRole("radio", { name: "✓ Fed" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("button", { name: "Save update" }).click();
  await page.waitForURL(/\/app\/colonies\/[0-9a-f-]+\?updated=1/);

  // ── Report an incident (type alone is enough to submit) ──
  await page.goto(`${url}/incidents/new`);
  await expect(
    page.getByRole("heading", { name: "Report an incident" }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Sick / injured" }).click();
  await page.getByRole("button", { name: /report/i }).click();
  await page.waitForURL(/\/app\/colonies\/[0-9a-f-]+\?reported=/);

  // ── Colony page reflects both writes (poll through the SWR cache) ──
  await reopenUntil(page, url, async () => {
    // Recent feeding updates section shows the fed outcome.
    const feeding = page
      .getByRole("heading", { name: "Recent feeding updates" })
      .locator("xpath=..");
    await expect(feeding.getByText(/^Fed$/)).toBeVisible();

    // Last-fed indicator replaces "Not fed yet".
    await expect(page.getByText(/^Last fed /)).toBeVisible();
    await expect(page.getByText("Not fed yet")).toHaveCount(0);

    // Recent incidents timeline shows the reported incident as a link.
    const incidents = page
      .getByRole("heading", { name: "Recent incidents" })
      .locator("xpath=..");
    await expect(
      incidents.getByRole("link", { name: /Sick \/ injured/ }),
    ).toBeVisible();
  });
});
