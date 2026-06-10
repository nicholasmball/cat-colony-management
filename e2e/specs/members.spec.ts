import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  createExtraMember,
  readRunState,
  serviceClient,
} from "../helpers/admin";

// ─────────────────────────────────────────────────────────────────────────────
// Members & invitations (admin-only). We:
//   • invite a brand-new volunteer → an invitations row + copy-link is created,
//   • change an extra member's role (feeder → caretaker),
//   • deactivate that extra member (soft-delete the membership),
//   • confirm a feeder cannot reach /app/members (server guard, write-attempt).
// Extra members are created via createExtraMember (appended to run-state so the
// auth user is torn down); the invitation row lives in the org (cascade-cleaned).
// ─────────────────────────────────────────────────────────────────────────────

test("admin invites a volunteer; an invitation row + link appear", async ({
  page,
}) => {
  const email = `e2e+invite-${randomUUID().slice(0, 8)}@scot-e2e.invalid`;

  await page.goto("/app/members");
  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();

  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send invite" }).click();

  // Redirects back with the invited toast naming the email (it also appears in
  // the pending-invites row, so just assert at least one occurrence).
  await page.waitForURL(/\/app\/members\?invited=/);
  await expect(page.getByText(email).first()).toBeVisible();

  // The invitation persisted in the test org (pending = accepted_at null).
  const { orgId } = readRunState();
  const svc = serviceClient();
  const { data } = await svc
    .from("invitations")
    .select("id, email, role, token, accepted_at")
    .eq("organisation_id", orgId!)
    .eq("email", email);
  expect(data?.length).toBe(1);
  expect(data![0].accepted_at).toBeNull();
  expect(data![0].token).toBeTruthy();
});

test("re-inviting an email with a prior accepted invitation succeeds (re-issue)", async ({
  page,
}) => {
  // Regression for the prod bug: re-inviting an email that already has an
  // invitations row (e.g. someone who accepted then was erased/removed) hit the
  // (organisation_id, lower(email)) unique index → 23505 → "pending invite
  // already exists", so NO fresh pending invite + NO email. The fix re-issues
  // (delete-then-insert), so the re-invite must succeed with a fresh pending row.
  const email = `e2e+reinvite-${randomUUID().slice(0, 8)}@scot-e2e.invalid`;
  const { orgId } = readRunState();
  const svc = serviceClient();

  // Seed a STALE ACCEPTED invitation for this email (the orphaned-after-erase
  // shape): accepted_at set, so it never appears in the pending list but still
  // occupies the unique index slot that used to block the re-invite. Mixed-case
  // stored email proves the case-insensitive (ilike) re-issue match.
  const { error: seedError } = await svc.from("invitations").insert({
    organisation_id: orgId!,
    email: email.toUpperCase(),
    role: "feeder",
    accepted_at: new Date().toISOString(),
  });
  expect(seedError).toBeNull();

  await page.goto("/app/members");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send invite" }).click();

  // Success: redirected with the invited toast, NOT the "pending invite already
  // exists" error.
  await page.waitForURL(/\/app\/members\?invited=/);
  await expect(
    page.getByText("That email already has a pending invite."),
  ).toHaveCount(0);

  // A fresh PENDING invite (accepted_at null) for this email now exists — the
  // stale accepted row was replaced, so exactly one row remains.
  await expect
    .poll(async () => {
      const { data } = await svc
        .from("invitations")
        .select("accepted_at")
        .eq("organisation_id", orgId!)
        .ilike("email", email);
      return data ?? [];
    })
    .toEqual([{ accepted_at: null }]);

  // And it surfaces in the Pending invites list in the UI.
  await expect(page.getByText(email).first()).toBeVisible();
});

test("re-inviting a CURRENT active member is still blocked (alreadyMember)", async ({
  page,
}) => {
  // The re-issue fix must NOT loosen the alreadyMember guard: an email belonging
  // to a current ACTIVE member of this org can't be re-invited.
  const svc = serviceClient();
  const member = await createExtraMember(svc, "feeder");

  await page.goto("/app/members");
  await page.getByLabel("Email").fill(member.email);
  await page.getByRole("button", { name: "Send invite" }).click();

  await page.waitForURL(/\/app\/members\?error=/);
  await expect(
    page.getByText("That person is already a member."),
  ).toBeVisible();
});

test("admin changes a member's role then deactivates them", async ({
  page,
}) => {
  // A dedicated throwaway member so the shared sessions stay untouched.
  const svc = serviceClient();
  const member = await createExtraMember(svc, "feeder");
  const { orgId } = readRunState();

  await page.goto("/app/members");
  // The member's row is keyed by their email; scope all actions to it.
  const row = page.locator("li").filter({ hasText: member.email });
  await expect(row).toBeVisible();

  // ── Promote feeder → caretaker (a promotion submits directly, no confirm) ──
  await row.getByLabel(`Role for ${member.email}`).selectOption("caretaker");
  await row.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/\/app\/members\?updated=/);

  const { data: afterRole } = await svc
    .from("memberships")
    .select("role")
    .eq("organisation_id", orgId!)
    .eq("user_id", member.id)
    .single();
  expect(afterRole?.role).toBe("caretaker");

  // ── Deactivate (soft-delete the membership) ──
  await page.goto("/app/members");
  const row2 = page.locator("li").filter({ hasText: member.email });
  await row2.getByRole("button", { name: "Deactivate" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Confirm" })
    .click();
  await page.waitForURL(/\/app\/members(\?|$)/);
  // The row now shows the "deactivated" label.
  await expect(
    page.locator("li").filter({ hasText: member.email }),
  ).toContainText("deactivated");

  await expect
    .poll(async () => {
      const { data } = await svc
        .from("memberships")
        .select("deleted_at")
        .eq("organisation_id", orgId!)
        .eq("user_id", member.id)
        .single();
      return data?.deleted_at;
    })
    .not.toBeNull();
});

test("feeder is blocked from /app/members (server guard)", async ({
  browser,
}) => {
  const ctx = await browser.newContext({
    storageState: "e2e/.auth/feeder.json",
  });
  const page = await ctx.newPage();
  await page.goto("/app/members");
  // Admin-only screen redirects a feeder to /app (then resolves to /app/today).
  await expect(page).not.toHaveURL(/\/app\/members/);
  await ctx.close();
});
