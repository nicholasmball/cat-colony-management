import { expect, test } from "@playwright/test";
import { readRunState, serviceClient } from "../helpers/admin";

// ─────────────────────────────────────────────────────────────────────────────
// Alert thresholds (/app/alerts, admin + caretaker). We:
//   • change the three thresholds and save → values persist on reload + DB,
//   • reject an out-of-range value with the localized error (NOT a crash),
//   • assert the labels render real EN text, never raw i18n keys — the explicit
//     regression guard for the i18n bug class that shipped earlier.
// The single test org's alert_settings row is mutated; teardown's cascade drops
// it with the org. Default storageState is admin.
// ─────────────────────────────────────────────────────────────────────────────

const NOT_SEEN = "not_seen_days";
const REPEATED = "repeated_not_seen";
const MISSED = "feeding_missed_hours";

test("labels render real text, not raw i18n keys", async ({ page }) => {
  await page.goto("/app/alerts");
  await expect(
    page.getByRole("heading", { name: "Alert thresholds" }),
  ).toBeVisible();

  // The real EN copy for each field label/unit is present…
  await expect(
    page.getByText("Days before a cat is flagged", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Misses in a row before", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Hours after feeding window", { exact: false }),
  ).toBeVisible();

  // …and NO raw namespaced key leaks through (the bug class: "alertSettings.x").
  await expect(page.getByText(/alertSettings\./)).toHaveCount(0);
  await expect(page.getByText(/\bnotSeenLabel\b/)).toHaveCount(0);
});

test("save the three thresholds; they persist on reload + in the DB", async ({
  page,
}) => {
  await page.goto("/app/alerts");

  // In-range values (bounds: 1–60 / 1–10 / 1–72).
  await page.locator(`input[name="${NOT_SEEN}"]`).fill("9");
  await page.locator(`input[name="${REPEATED}"]`).fill("4");
  await page.locator(`input[name="${MISSED}"]`).fill("10");
  await page.getByRole("button", { name: "Save thresholds" }).click();

  // Saved toast + values survive a reload. Target the page's role=status toast
  // specifically — the sidebar sync indicator also says "All saved".
  await page.waitForURL(/\/app\/alerts\?saved=1/);
  await expect(
    page.getByRole("status").filter({ hasText: "Saved" }),
  ).toBeVisible();

  await page.goto("/app/alerts");
  await expect(page.locator(`input[name="${NOT_SEEN}"]`)).toHaveValue("9");
  await expect(page.locator(`input[name="${REPEATED}"]`)).toHaveValue("4");
  await expect(page.locator(`input[name="${MISSED}"]`)).toHaveValue("10");

  // DB reflects it, scoped to the test org.
  const { orgId } = readRunState();
  const svc = serviceClient();
  const { data } = await svc
    .from("alert_settings")
    .select("not_seen_days, repeated_not_seen, feeding_missed_hours")
    .eq("organisation_id", orgId!)
    .single();
  expect(data?.not_seen_days).toBe(9);
  expect(data?.repeated_not_seen).toBe(4);
  expect(data?.feeding_missed_hours).toBe(10);
});

test("an out-of-range value is rejected with a localized error", async ({
  page,
}) => {
  await page.goto("/app/alerts");

  // 99 > the 60 max for not_seen_days. The native min/max is only a hint; the
  // server re-validates and redirects with ?error=. Drop the attributes so the
  // browser submits the bad value rather than blocking it client-side.
  const field = page.locator(`input[name="${NOT_SEEN}"]`);
  await field.evaluate((el) => {
    el.removeAttribute("min");
    el.removeAttribute("max");
  });
  await field.fill("99");
  await page.getByRole("button", { name: "Save thresholds" }).click();

  await page.waitForURL(/\/app\/alerts\?error=/);
  // The page's own red error banner (the Next route-announcer is also role=alert,
  // so scope to the styled <p role="alert"> with the real copy).
  const alert = page.getByRole("alert").filter({ hasText: /\S/ });
  await expect(alert.first()).toBeVisible();
  await expect(alert.first()).toContainText("whole number");
  await expect(alert.first()).not.toContainText("errors.");
});
