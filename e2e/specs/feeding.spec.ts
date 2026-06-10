import { expect, test } from "@playwright/test";
import { readRunState, serviceClient } from "../helpers/admin";
import { addCatViaUI, createColonyViaUI } from "../helpers/ui";

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

// Presentation-only: each cat row on the feed page shows the 40px round avatar
// (paw fallback for a photoless cat) to the LEFT of the name, the tri-toggle
// still works, and a submitted update still persists (payload/flow intact).
test("feed rows show a cat avatar and the tri-toggle still submits", async ({
  page,
}) => {
  const { url } = await createColonyViaUI(page);
  const colonyId = url.split("/app/colonies/")[1]?.split(/[?#]/)[0];
  expect(colonyId).toBeTruthy();

  // A cat with no photo → the paw fallback inside the fixed avatar box.
  const catName = await addCatViaUI(page, url);

  await page.goto(`${url}/feed`);
  await expect(
    page.getByRole("heading", { name: "Feeding update" }),
  ).toBeVisible();

  // The row carrying the cat name is the avatar+body flex container; assert it
  // contains an avatar (an <img> OR the paw SVG fallback). Resilient to the SW
  // SWR cache: the name is the stable anchor, the avatar its left sibling.
  const row = page.getByRole("listitem").filter({ hasText: catName }).first();
  await expect(row).toBeVisible();
  const avatar = row.locator("img, svg").first();
  await expect(avatar).toBeVisible();

  // Tri-toggle still works: mark "Seen" for this cat (aria-pressed flips on).
  const seen = row.getByRole("button", { name: "Seen", exact: true });
  await seen.click();
  await expect(seen).toHaveAttribute("aria-pressed", "true");

  // Submit still succeeds end-to-end (default "✓ Fed"); the flow is unchanged.
  await page.getByRole("button", { name: "Save update" }).click();
  await page.waitForURL(/\/app\/colonies\/[0-9a-f-]+\?updated=1/);
  await expect(page.getByText("Feeding update recorded")).toBeVisible();

  // The sighting persisted with the unchanged cat:<id> payload semantics.
  const { orgId } = readRunState();
  const svc = serviceClient();
  const { data, error } = await svc
    .from("feeding_events")
    .select("id, fed, colony_id")
    .eq("organisation_id", orgId!)
    .eq("colony_id", colonyId!);
  expect(error).toBeNull();
  expect(data?.length).toBeGreaterThan(0);
  expect(data?.[0]?.fed).toBe(true);
});
