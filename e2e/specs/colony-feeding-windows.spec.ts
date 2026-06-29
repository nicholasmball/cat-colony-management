import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { readRunState, serviceClient } from "../helpers/admin";

// ─────────────────────────────────────────────────────────────────────────────
// Colony feeding windows (multiple daily feed times — migration 0013).
// A manager creates a colony with TWO feeding windows, edits it to add a third
// and remove the first, and we assert at each step that:
//   • the colony_feeding_windows rows persist (service-role read, test-org scoped),
//   • the colony detail page renders every window in order.
// All rows live in the throwaway org; teardown's org cascade cleans them up
// (colony_feeding_windows is ON DELETE CASCADE from colonies → organisations).
//
// NOTE: this spec goes green only AFTER migration 0013 is applied + the build is
// deployed to prod — the e2e suite runs against prod (the table must exist and
// the new editor must be live). Until then it is expected to fail, exactly like
// every other prod-targeting spec gated on a pending migration/deploy.
// ─────────────────────────────────────────────────────────────────────────────

test("create colony with two windows, then edit to add a third + remove one", async ({
  page,
}) => {
  const name = `E2E Windows ${randomUUID().slice(0, 8)}`;
  const svc = serviceClient();
  const { orgId } = readRunState();
  expect(orgId).toBeTruthy();

  // ── Create: one row is present by default; add a second, fill both ──
  await page.goto("/app/colonies/new");
  await page.getByLabel("Name").fill(name);

  const startInputs = page.locator('input[name="window_start"]');
  const endInputs = page.locator('input[name="window_end"]');

  await startInputs.nth(0).fill("07:00");
  await endInputs.nth(0).fill("08:00");
  await page.getByRole("button", { name: "Add feeding time" }).click();
  await expect(startInputs).toHaveCount(2);
  await startInputs.nth(1).fill("18:00");
  await endInputs.nth(1).fill("19:00");

  await page.getByRole("button", { name: "Create colony" }).click();
  await page.waitForURL(/\/app\/colonies(\?|$)/);

  // Open the colony detail page.
  const listLink = page.getByRole("link", { name });
  await expect(listLink).toBeVisible();
  await listLink.click();
  await page.waitForURL(/\/app\/colonies\/[0-9a-f-]+/);
  const colonyId = page.url().split("/app/colonies/")[1]?.split(/[?#]/)[0];
  expect(colonyId).toBeTruthy();

  // Detail header lists both windows, in order.
  await expect(page.getByText("07:00–08:00 · 18:00–19:00")).toBeVisible();

  // Two rows persisted.
  await expect
    .poll(async () => {
      const { data } = await svc
        .from("colony_feeding_windows")
        .select("window_start, window_end, position")
        .eq("organisation_id", orgId!)
        .eq("colony_id", colonyId!)
        .order("position");
      return (data ?? []).map((r) => `${r.window_start}|${r.window_end}`);
    })
    .toEqual(["07:00:00|08:00:00", "18:00:00|19:00:00"]);

  // ── Edit: add a third window, then remove the FIRST → final set is the
  // original second + third (12:30–13:00 added, 07:00 removed). ──
  await page.goto(`/app/colonies/${colonyId}/edit`);
  await expect(startInputs).toHaveCount(2);
  await page.getByRole("button", { name: "Add feeding time" }).click();
  await expect(startInputs).toHaveCount(3);
  await startInputs.nth(2).fill("12:30");
  await endInputs.nth(2).fill("13:00");

  // Remove the first feeding time (07:00–08:00).
  await page.getByRole("button", { name: "Remove feeding time 1" }).click();
  await expect(startInputs).toHaveCount(2);

  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(/\/app\/colonies\/[0-9a-f-]+(\?|$)/);

  // Final persisted set: two windows (18:00–19:00 + 12:30–13:00), re-positioned.
  await expect
    .poll(async () => {
      const { data } = await svc
        .from("colony_feeding_windows")
        .select("window_start, window_end")
        .eq("organisation_id", orgId!)
        .eq("colony_id", colonyId!);
      return (data ?? [])
        .map((r) => `${r.window_start}|${r.window_end}`)
        .sort();
    })
    .toEqual(["12:30:00|13:00:00", "18:00:00|19:00:00"]);
});
