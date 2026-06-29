import { expect, test } from "@playwright/test";
import { readRunState, serviceClient } from "../helpers/admin";
import { createColonyViaUI } from "../helpers/ui";

// The optional "Time fed" control on the feeding update. It surfaces + lets the
// feeder adjust the observed_at the form already mints at tap, pre-filled to now
// in the ORG timezone. These assert the persisted observed_at (event row), so
// they go green only POST-DEPLOY (the e2e suite runs against prod).

// Org-local minutes-of-day for an instant, via Intl (mirrors lib/time helpers
// without importing app code into the Playwright runtime).
function localMinutes(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  let h = 0;
  let m = 0;
  for (const p of parts) {
    if (p.type === "hour") h = Number(p.value) % 24;
    else if (p.type === "minute") m = Number(p.value);
  }
  return h * 60 + m;
}

function hhmm(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// The throwaway org is created via the create_organisation RPC, which defaults
// the timezone to Europe/Lisbon. Read it back so the assertion is tz-correct.
async function orgTimezone(): Promise<string> {
  const { orgId } = readRunState();
  const svc = serviceClient();
  const { data } = await svc
    .from("organisations")
    .select("timezone")
    .eq("id", orgId!)
    .maybeSingle();
  return (data?.timezone as string | undefined) ?? "Europe/Lisbon";
}

test("adjusting 'Time fed' persists that earlier time as observed_at", async ({
  page,
}) => {
  const tz = await orgTimezone();
  const { url } = await createColonyViaUI(page);
  const colonyId = url.split("/app/colonies/")[1]?.split(/[?#]/)[0];
  expect(colonyId).toBeTruthy();

  await page.goto(`${url}/feed`);
  await expect(
    page.getByRole("heading", { name: "Feeding update" }),
  ).toBeVisible();

  // Pick an explicit EARLIER time-of-day today (still valid — never a future):
  // 90 min before now where there's room, else half of today's minutes. Always
  // < now and >= 0, so it's "today" in the org tz and passes the future guard.
  const nowMin = localMinutes(new Date(), tz);
  const earlierMin = nowMin >= 90 ? nowMin - 90 : Math.floor(nowMin / 2);
  const chosen = hhmm(earlierMin);

  const timeInput = page.getByLabel("Time fed");
  await expect(timeInput).toBeVisible();
  await timeInput.fill(chosen);
  // The "✓ Edited" cue appears only after a real change.
  await expect(page.getByText("✓ Edited")).toBeVisible();

  await page.getByRole("button", { name: "Save update" }).click();
  await page.waitForURL(/\/app\/colonies\/[0-9a-f-]+\?updated=1/);
  await expect(page.getByText("Feeding update recorded")).toBeVisible();

  const { orgId } = readRunState();
  const svc = serviceClient();
  const { data, error } = await svc
    .from("feeding_events")
    .select("id, observed_at, colony_id")
    .eq("organisation_id", orgId!)
    .eq("colony_id", colonyId!);
  expect(error).toBeNull();
  expect(data?.length).toBe(1);

  // The stored observed_at, read back as org-local HH:MM, is the chosen time —
  // NOT ~now (the submit time), proving the control drove the timestamp.
  const observedAt = new Date(data![0]!.observed_at as string);
  expect(hhmm(localMinutes(observedAt, tz))).toBe(chosen);
});

test("leaving 'Time fed' untouched stamps observed_at at ~now", async ({
  page,
}) => {
  const { url } = await createColonyViaUI(page);
  const colonyId = url.split("/app/colonies/")[1]?.split(/[?#]/)[0];
  expect(colonyId).toBeTruthy();

  await page.goto(`${url}/feed`);
  await expect(
    page.getByRole("heading", { name: "Feeding update" }),
  ).toBeVisible();

  // Do NOT touch the control — the zero-interaction common case.
  const before = Date.now();
  await page.getByRole("button", { name: "Save update" }).click();
  await page.waitForURL(/\/app\/colonies\/[0-9a-f-]+\?updated=1/);
  await expect(page.getByText("Feeding update recorded")).toBeVisible();
  const after = Date.now();

  const { orgId } = readRunState();
  const svc = serviceClient();
  const { data, error } = await svc
    .from("feeding_events")
    .select("id, observed_at, colony_id")
    .eq("organisation_id", orgId!)
    .eq("colony_id", colonyId!);
  expect(error).toBeNull();
  expect(data?.length).toBe(1);

  // observed_at is ~now: within the submit window (± a 5-min skew cushion).
  const observedMs = new Date(data![0]!.observed_at as string).getTime();
  expect(observedMs).toBeGreaterThanOrEqual(before - 5 * 60 * 1000);
  expect(observedMs).toBeLessThanOrEqual(after + 5 * 60 * 1000);
});
