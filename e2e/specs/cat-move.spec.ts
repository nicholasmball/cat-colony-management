import { expect, test } from "@playwright/test";
import { createColonyViaUI } from "../helpers/ui";

// ─────────────────────────────────────────────────────────────────────────────
// Move a cat between colonies (single-cat, managers only, no history). As admin:
// create colony A + colony B, add a cat to A, then use the Move control on the
// cat detail page to move it to B. Assert the cat now lists under B and is gone
// from A. Lives entirely inside the throwaway per-run org (teardown's cascade
// covers the rows). Default storageState is admin.
// ─────────────────────────────────────────────────────────────────────────────

test("admin moves a cat from one colony to another", async ({ page }) => {
  // Two colonies. createColonyViaUI leaves us on the second one's detail page.
  const a = await createColonyViaUI(page);
  const b = await createColonyViaUI(page);

  // Add a cat to colony A via the manager full form.
  const catName = `E2E MoveCat ${Date.now()}`;
  await page.goto(`${a.url}/cats/new`);
  await page.getByLabel("Name", { exact: true }).fill(catName);
  await page.getByRole("button", { name: "Add cat" }).click();
  await page.waitForURL(/\/app\/colonies\/[0-9a-f-]+(\?|$)/);

  // Open the cat from colony A.
  await page.goto(a.url);
  const catLink = page.getByRole("link", { name: new RegExp(catName) });
  await expect(catLink).toBeVisible();
  await catLink.click();
  await page.waitForURL(/\/app\/colonies\/[0-9a-f-]+\/cats\/[0-9a-f-]+/);

  // Use the Move control: pick colony B by its visible name, then submit.
  await page.getByLabel("Move this cat to").selectOption({ label: b.name });
  await page.getByRole("button", { name: "Move", exact: true }).click();

  // Redirects to the cat under its new colony with the moved toast.
  await page.waitForURL(
    /\/app\/colonies\/[0-9a-f-]+\/cats\/[0-9a-f-]+\?moved=1/,
  );
  await expect(page.getByRole("status")).toBeVisible();

  // The new URL's colony id is B's.
  const bId = b.url.split("/app/colonies/")[1]?.split(/[?#]/)[0];
  expect(page.url()).toContain(`/app/colonies/${bId}/cats/`);

  // It now appears under colony B, and is gone from colony A. Colony detail
  // pages are stale-while-revalidate-cached by the service worker (the
  // offline-nav caching), so re-reading colony A — which was viewed BEFORE the
  // move — can serve a stale cached page until the SW revalidates. Re-navigate
  // until the cache catches up. (The move itself is already proven above: the
  // submit redirected to the cat under colony B with the moved toast.)
  await expect(async () => {
    await page.goto(b.url);
    expect(
      await page.getByRole("link", { name: new RegExp(catName) }).count(),
    ).toBe(1);
  }).toPass({ timeout: 20000 });

  await expect(async () => {
    await page.goto(a.url);
    expect(
      await page.getByRole("link", { name: new RegExp(catName) }).count(),
    ).toBe(0);
  }).toPass({ timeout: 20000 });
});
