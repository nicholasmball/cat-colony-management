import { expect, test } from "@playwright/test";

// ─────────────────────────────────────────────────────────────────────────────
// Access guards / role redirects. Each manager-only page redirects a feeder to
// /app/today; the admin-only pages redirect a caretaker to /app/today (alerts +
// dashboard); admin reaches everything. We assert on the LANDING url, not on
// chrome, so the test reflects the real server-side getActiveOrg() guards.
//
// Each block sets storageState per role (the sessions captured in global-setup),
// so the tests stay isolated and order-independent.
// ─────────────────────────────────────────────────────────────────────────────

const MANAGER_ONLY = [
  "/app/dashboard",
  "/app/incidents",
  "/app/alerts",
  "/app/members",
  "/app/org",
];

// Caretaker can reach these (they're manager pages, not admin-only).
const CARETAKER_OK = ["/app/dashboard", "/app/alerts", "/app/incidents"];
// Admin-only — a caretaker is bounced to /app/today.
const ADMIN_ONLY = ["/app/members", "/app/org"];

test.describe("feeder is locked out of manager pages", () => {
  test.use({ storageState: "e2e/.auth/feeder.json" });

  for (const path of MANAGER_ONLY) {
    test(`feeder visiting ${path} is bounced away`, async ({ page }) => {
      await page.goto(path);
      // incidents/dashboard/alerts redirect to /app/today; members/org redirect
      // to /app (which a feeder may rest on). Either way they NEVER stay on the
      // requested manager page.
      await expect(page).not.toHaveURL(new RegExp(path.replace(/\//g, "\\/")));
      await expect(page).toHaveURL(/\/app(\/today)?(\/|$|\?)/);
    });
  }

  test("feeder CAN reach /app/today and /app/colonies", async ({ page }) => {
    await page.goto("/app/today");
    await expect(page).toHaveURL(/\/app\/today/);
    await page.goto("/app/colonies");
    await expect(page).toHaveURL(/\/app\/colonies/);
  });
});

test.describe("caretaker reaches manager pages but not admin-only", () => {
  test.use({ storageState: "e2e/.auth/caretaker.json" });

  for (const path of CARETAKER_OK) {
    test(`caretaker reaches ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(path.replace(/\//g, "\\/")));
    });
  }

  for (const path of ADMIN_ONLY) {
    test(`caretaker visiting ${path} is bounced away`, async ({ page }) => {
      await page.goto(path);
      // members/org are admin-only and redirect a caretaker to /app.
      await expect(page).not.toHaveURL(new RegExp(path.replace(/\//g, "\\/")));
      await expect(page).toHaveURL(/\/app(\/today)?(\/|$|\?)/);
    });
  }
});

test.describe("admin reaches every page", () => {
  test.use({ storageState: "e2e/.auth/admin.json" });

  for (const path of MANAGER_ONLY) {
    test(`admin reaches ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(path.replace(/\//g, "\\/")));
    });
  }
});
