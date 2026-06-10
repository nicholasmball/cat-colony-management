import { expect, test } from "@playwright/test";
import {
  createExtraMember,
  readRunState,
  serviceClient,
} from "../helpers/admin";

// ─────────────────────────────────────────────────────────────────────────────
// Permanently ERASE a member (GDPR right-to-be-forgotten) — admin-only, and the
// destructive sibling of Deactivate. This spec proves the RAILS, because the
// action deletes the auth account and cascades/nulls everywhere:
//   • admin erases an EXTRA member → the row disappears AND, via the service
//     client, the auth user + membership are gone,
//   • admin CANNOT erase self (no delete control on their own row),
//   • admin CANNOT erase the last admin (blocked with the localized error),
//   • a feeder cannot reach the admin-only members screen at all.
// The erased extra member stays in run-state; teardown's deleteUser tolerates an
// already-deleted user (the "user not found" branch), so the run still verifies
// clean.
// ─────────────────────────────────────────────────────────────────────────────

test("admin permanently erases an extra member; auth user + membership are gone", async ({
  page,
}) => {
  const svc = serviceClient();
  const member = await createExtraMember(svc, "feeder");
  const { orgId } = readRunState();

  await page.goto("/app/members");
  const row = page.locator("li").filter({ hasText: member.email });
  await expect(row).toBeVisible();

  // The erase button's accessible name is its aria-label ("Permanently delete
  // the account for <email>"), NOT the visible "Delete account" text — match
  // that. (Same locator is used below to PROVE the button is absent on the
  // self/last-admin rows, so the absence assertions are meaningful, not vacuous.)
  await row
    .getByRole("button", { name: /permanently delete the account/i })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete permanently" })
    .click();

  // Redirect back with the success flag; the member's row is gone.
  await page.waitForURL(/\/app\/members\?ok=erased/);
  await expect(page.getByText("Account permanently deleted")).toBeVisible();
  await expect(
    page.locator("li").filter({ hasText: member.email }),
  ).toHaveCount(0);

  // The membership row cascaded away with the auth user.
  await expect
    .poll(async () => {
      const { data } = await svc
        .from("memberships")
        .select("user_id")
        .eq("organisation_id", orgId!)
        .eq("user_id", member.id);
      return data?.length ?? 0;
    })
    .toBe(0);

  // The auth user itself is gone.
  const { data: gone } = await svc.auth.admin.getUserById(member.id);
  expect(gone.user).toBeNull();
});

test("admin permanently erases a DEACTIVATED member; auth user + membership are gone", async ({
  page,
}) => {
  const svc = serviceClient();
  const member = await createExtraMember(svc, "feeder");
  const { orgId } = readRunState();

  // Soft-delete the membership first (deleted_at set) — the prod bug was that a
  // deactivated member couldn't be erased because the target lookup filtered to
  // active rows only. This proves the fix end-to-end.
  await svc
    .from("memberships")
    .update({ deleted_at: new Date().toISOString() })
    .eq("organisation_id", orgId!)
    .eq("user_id", member.id);

  await page.goto("/app/members");
  const row = page.locator("li").filter({ hasText: member.email });
  await expect(row).toBeVisible();
  // The row is marked deactivated, yet still offers the erase control.
  await expect(row.getByText(/deactivated/i)).toBeVisible();

  await row
    .getByRole("button", { name: /permanently delete the account/i })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete permanently" })
    .click();

  // Redirect back with the success flag; the deactivated member's row is gone.
  await page.waitForURL(/\/app\/members\?ok=erased/);
  await expect(page.getByText("Account permanently deleted")).toBeVisible();
  await expect(
    page.locator("li").filter({ hasText: member.email }),
  ).toHaveCount(0);

  // The membership row cascaded away with the auth user.
  await expect
    .poll(async () => {
      const { data } = await svc
        .from("memberships")
        .select("user_id")
        .eq("organisation_id", orgId!)
        .eq("user_id", member.id);
      return data?.length ?? 0;
    })
    .toBe(0);

  // The auth user itself is gone.
  const { data: gone } = await svc.auth.admin.getUserById(member.id);
  expect(gone.user).toBeNull();
});

test("admin cannot erase their own account (no delete control on self row)", async ({
  page,
}) => {
  await page.goto("/app/members");

  // The admin's own row is the one marked "You".
  const selfRow = page.locator("li").filter({ hasText: "You" }).first();
  await expect(selfRow).toBeVisible();
  await expect(
    selfRow.getByRole("button", { name: /permanently delete the account/i }),
  ).toHaveCount(0);
});

test("the sole admin (last admin) has no delete control and stays intact", async ({
  page,
}) => {
  const svc = serviceClient();
  const { orgId } = readRunState();

  // The shared admin is the SOLE admin of the test org — the last-admin rail
  // and the self rail both protect them. Confirm the count, then prove via the
  // UI that there's no way to erase them: their own row offers no delete
  // control, and the server still has them after we've poked the screen.
  const { data: admins } = await svc
    .from("memberships")
    .select("user_id")
    .eq("organisation_id", orgId!)
    .eq("role", "admin")
    .is("deleted_at", null);
  expect(admins?.length).toBe(1);
  const lastAdminId = admins![0].user_id;

  await page.goto("/app/members");
  const selfRow = page.locator("li").filter({ hasText: "You" }).first();
  await expect(selfRow).toBeVisible();
  await expect(
    selfRow.getByRole("button", { name: /permanently delete the account/i }),
  ).toHaveCount(0);

  // The sole admin is still present (the unit matrix proves the server-side
  // cannotEraseLastAdmin rail for a non-self caller; here we hold the line that
  // the UI never even offers it for the last admin).
  const { data: stillThere } = await svc.auth.admin.getUserById(lastAdminId);
  expect(stillThere.user).not.toBeNull();
});

test("feeder cannot reach the members screen (admin-only)", async ({
  browser,
}) => {
  const ctx = await browser.newContext({
    storageState: "e2e/.auth/feeder.json",
  });
  const page = await ctx.newPage();
  await page.goto("/app/members");
  await expect(page).not.toHaveURL(/\/app\/members/);
  await ctx.close();
});
