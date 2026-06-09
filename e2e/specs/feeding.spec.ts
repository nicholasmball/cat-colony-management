import { expect, test } from "@playwright/test";
import { readRunState, serviceClient } from "../helpers/admin";
import { createColonyViaUI } from "../helpers/ui";

// Open a colony's feed form, submit a "fed" update → success toast, and verify
// a feeding_events row was written (service-role read scoped to the TEST org).
test("submit a 'fed' feeding update and confirm it persisted", async ({
  page,
}) => {
  const { url } = await createColonyViaUI(page);
  const colonyId = url.split("/app/colonies/")[1]?.split(/[?#]/)[0];
  expect(colonyId).toBeTruthy();

  await page.goto(`${url}/feed`);
  await expect(
    page.getByRole("heading", { name: "Feeding update" }),
  ).toBeVisible();

  // "✓ Fed" is the default-selected option; submit the update.
  await expect(page.getByRole("radio", { name: "✓ Fed" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("button", { name: "Save update" }).click();

  // The form POSTs /api/feedings then navigates back to the colony with the
  // success flag, which renders the "Feeding update recorded" toast.
  await page.waitForURL(/\/app\/colonies\/[0-9a-f-]+\?updated=1/);
  await expect(page.getByText("Feeding update recorded")).toBeVisible();

  // Verify the row exists, scoped to the throwaway org + this colony only.
  const { orgId } = readRunState();
  const svc = serviceClient();
  const { data, error } = await svc
    .from("feeding_events")
    .select("id, fed, colony_id, organisation_id")
    .eq("organisation_id", orgId!)
    .eq("colony_id", colonyId!);
  expect(error).toBeNull();
  expect(data?.length).toBeGreaterThan(0);
  expect(data?.[0]?.fed).toBe(true);
});
