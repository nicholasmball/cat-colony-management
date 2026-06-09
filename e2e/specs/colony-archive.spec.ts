import { expect, test } from "@playwright/test";
import { readRunState, serviceClient } from "../helpers/admin";
import { createColonyViaUI } from "../helpers/ui";

// ─────────────────────────────────────────────────────────────────────────────
// Colony archive. A manager archives a colony from its edit page → it disappears
// from the active colonies list (the list filters deleted_at is null). We verify
// both the UI list AND the soft-delete in the DB, scoped to the test org.
// ─────────────────────────────────────────────────────────────────────────────

test("manager archives a colony; it leaves the active list", async ({
  page,
}) => {
  const { name, url } = await createColonyViaUI(page);
  const colonyId = url.split("/app/colonies/")[1]?.split(/[?#]/)[0];
  expect(colonyId).toBeTruthy();

  // It's in the active list to begin with.
  await page.goto("/app/colonies");
  await expect(page.getByRole("link", { name })).toBeVisible();

  // Archive from the edit page.
  await page.goto(`${url}/edit`);
  await page.getByRole("button", { name: "Archive colony" }).click();
  // archiveColony redirects to the colonies list.
  await page.waitForURL(/\/app\/colonies(\?|$)/);

  // Gone from the active list.
  await expect(page.getByRole("link", { name })).toHaveCount(0);

  // Soft-deleted in the DB (deleted_at set), scoped to the test org.
  const { orgId } = readRunState();
  const svc = serviceClient();
  const { data } = await svc
    .from("colonies")
    .select("id, deleted_at")
    .eq("organisation_id", orgId!)
    .eq("id", colonyId!)
    .single();
  expect(data?.deleted_at).not.toBeNull();
});
