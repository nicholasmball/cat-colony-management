import { expect, test } from "@playwright/test";
import { readRunState, serviceClient } from "../helpers/admin";
import { addCatViaUI, createColonyViaUI } from "../helpers/ui";

// The tap-to-mark-seen grid (components/feed-form.tsx + lib/feed-sightings.ts)
// replaced the per-cat tri-toggle. These specs prove the new UI still writes the
// SAME cat_sightings rows the route + enum expect (seen / not_seen / concern),
// for the right cats, with one feeding_event — and that the "I checked the whole
// colony" checkbox correctly switches between a full round (un-tapped → not_seen)
// and a partial round (un-tapped → no row). Service-role reads are scoped to the
// throwaway TEST org only.

// Helper: fetch cat id→name for a colony (TEST org scoped).
async function catIdsByName(orgId: string, colonyId: string) {
  const svc = serviceClient();
  const { data, error } = await svc
    .from("cats")
    .select("id, name")
    .eq("organisation_id", orgId)
    .eq("colony_id", colonyId);
  expect(error).toBeNull();
  const byName = new Map<string, string>();
  for (const row of data ?? [])
    byName.set(row.name as string, row.id as string);
  return byName;
}

test("full round: tapped→seen, flagged→concern, un-tapped→not_seen", async ({
  page,
}) => {
  const { url } = await createColonyViaUI(page);
  const colonyId = url.split("/app/colonies/")[1]?.split(/[?#]/)[0];
  expect(colonyId).toBeTruthy();

  // Three cats: one we'll tap (seen), one we'll flag (concern), one we leave
  // un-tapped (→ not_seen with the box ON by default).
  const seenCat = await addCatViaUI(page, url);
  const concernCat = await addCatViaUI(page, url);
  const notSeenCat = await addCatViaUI(page, url);

  await page.goto(`${url}/feed`);
  await expect(
    page.getByRole("heading", { name: "Feeding update" }),
  ).toBeVisible();

  // Tap the SEEN cat's main tile (DOM order: main button first, flag second).
  const seenTile = page.getByRole("listitem").filter({ hasText: seenCat });
  await expect(seenTile).toBeVisible();
  const seenMain = seenTile.getByRole("button").first();
  await seenMain.click();
  await expect(seenMain).toHaveAttribute("aria-pressed", "true");

  // Flag the CONCERN cat via its separate corner control (overrides seen/not).
  const flag = page.getByRole("button", {
    name: `Report a problem with ${concernCat}`,
  });
  await flag.click();
  await expect(
    page.getByRole("button", {
      name: `Problem reported for ${concernCat}. Tap to clear.`,
    }),
  ).toBeVisible();

  // notSeenCat is left un-tapped → the default-ON checkbox writes it not_seen.
  await expect(
    page.getByRole("checkbox", { name: /I checked the whole colony/ }),
  ).toBeChecked();

  await page.getByRole("button", { name: "Save update" }).click();
  await page.waitForURL(/\/app\/colonies\/[0-9a-f-]+\?updated=1/);
  await expect(page.getByText("Feeding update recorded")).toBeVisible();

  const { orgId } = readRunState();
  const svc = serviceClient();

  // Exactly one feeding_event for this colony.
  const { data: events } = await svc
    .from("feeding_events")
    .select("id")
    .eq("organisation_id", orgId!)
    .eq("colony_id", colonyId!);
  expect(events?.length).toBe(1);

  // The three sightings carry the right status for the right cat.
  const byName = await catIdsByName(orgId!, colonyId!);
  const ids = [seenCat, concernCat, notSeenCat].map((n) => byName.get(n)!);
  const { data: sightings, error } = await svc
    .from("cat_sightings")
    .select("cat_id, status")
    .in("cat_id", ids);
  expect(error).toBeNull();
  const statusByCat = new Map(
    (sightings ?? []).map((s) => [s.cat_id as string, s.status as string]),
  );
  expect(statusByCat.get(byName.get(seenCat)!)).toBe("seen");
  expect(statusByCat.get(byName.get(concernCat)!)).toBe("concern");
  expect(statusByCat.get(byName.get(notSeenCat)!)).toBe("not_seen");
});

test("partial round: box OFF → un-tapped cats get NO sighting", async ({
  page,
}) => {
  const { url } = await createColonyViaUI(page);
  const colonyId = url.split("/app/colonies/")[1]?.split(/[?#]/)[0];
  expect(colonyId).toBeTruthy();

  const tappedCat = await addCatViaUI(page, url);
  const skippedCat = await addCatViaUI(page, url);

  await page.goto(`${url}/feed`);
  await expect(
    page.getByRole("heading", { name: "Feeding update" }),
  ).toBeVisible();

  // Tap one cat seen.
  const tile = page.getByRole("listitem").filter({ hasText: tappedCat });
  await expect(tile).toBeVisible();
  const main = tile.getByRole("button").first();
  await main.click();
  await expect(main).toHaveAttribute("aria-pressed", "true");

  // Untick "I checked the whole colony" → partial round: the un-tapped cat must
  // NOT be written not_seen.
  const box = page.getByRole("checkbox", {
    name: /I checked the whole colony/,
  });
  await box.uncheck();
  await expect(box).not.toBeChecked();

  await page.getByRole("button", { name: "Save update" }).click();
  await page.waitForURL(/\/app\/colonies\/[0-9a-f-]+\?updated=1/);
  await expect(page.getByText("Feeding update recorded")).toBeVisible();

  const { orgId } = readRunState();
  const svc = serviceClient();
  const byName = await catIdsByName(orgId!, colonyId!);

  const { data: sightings, error } = await svc
    .from("cat_sightings")
    .select("cat_id, status")
    .in(
      "cat_id",
      [tappedCat, skippedCat].map((n) => byName.get(n)!),
    );
  expect(error).toBeNull();
  const statusByCat = new Map(
    (sightings ?? []).map((s) => [s.cat_id as string, s.status as string]),
  );
  // The tapped cat is seen; the skipped cat has NO row at all (partial round).
  expect(statusByCat.get(byName.get(tappedCat)!)).toBe("seen");
  expect(statusByCat.has(byName.get(skippedCat)!)).toBe(false);
});
