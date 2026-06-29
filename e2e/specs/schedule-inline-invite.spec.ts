import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { readRunState, serviceClient } from "../helpers/admin";
import { createColonyViaUI } from "../helpers/ui";

// ─────────────────────────────────────────────────────────────────────────────
// Inline "Invite a new volunteer" on the Add-schedule form (Option A). We:
//   • as an ADMIN, expand the invite disclosure on the schedule form, invite a
//     brand-new volunteer → assert an invitations row exists with role='feeder'
//     in the active org, that the admin lands back on the schedule route (not
//     /app/members) with the in-context "no schedule created" confirmation, and
//     that the just-invited email shows as a read-only "Invited · pending" entry
//     and NOT inside the feeder <select>;
//   • as a CARETAKER, confirm the invite affordance is absent (admin-only);
//   • with an existing assignable feeder, the schedule form still selects + saves
//     (no regression).
//
// The invitation rows live in the throwaway test org (cascade-cleaned on
// teardown); we also delete them explicitly here to keep the org tidy between
// runs. NOTE: this asserts behaviour that ships with the schedule-inline-invite
// branch — against PROD it only goes green post-deploy.
// ─────────────────────────────────────────────────────────────────────────────

test("admin invites a new volunteer inline from the schedule form; pending entry + in-context confirmation, no schedule created", async ({
  page,
}) => {
  const email = `e2e+sched-invite-${randomUUID().slice(0, 8)}@scot-e2e.invalid`;
  const { orgId } = readRunState();
  const svc = serviceClient();

  const { url } = await createColonyViaUI(page);
  const colonyId = url.split("/app/colonies/")[1]?.split(/[?#]/)[0];
  expect(colonyId).toBeTruthy();

  try {
    await page.goto(`${url}/schedules/new`);
    await expect(
      page.getByRole("heading", { name: "Add schedule" }),
    ).toBeVisible();

    // The affordance is a collapsed disclosure (admin-only). Expand it.
    const toggle = page.getByRole("button", {
      name: "Invite a new volunteer",
    });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    // The inline panel (not a modal) reveals the email field; fill + send.
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send invitation" }).click();

    // Returns to THIS schedule route (no open redirect to /app/members) with the
    // in-context confirmation that makes clear no schedule was created.
    await page.waitForURL(
      new RegExp(`/app/colonies/${colonyId}/schedules/new\\?invited=`),
    );
    const status = page.getByRole("status");
    await expect(status).toContainText(email);
    await expect(status).toContainText("No schedule was created");

    // The invitation persisted as a pending feeder invite in the test org.
    const { data } = await svc
      .from("invitations")
      .select("email, role, accepted_at")
      .eq("organisation_id", orgId!)
      .eq("email", email);
    expect(data?.length).toBe(1);
    expect(data![0].role).toBe("feeder");
    expect(data![0].accepted_at).toBeNull();

    // Surfaces as a read-only "Invited · pending" entry near the select…
    await expect(page.getByText("Invited · pending").first()).toBeVisible();
    // …but is NOT an option in the feeder <select> (un-accepted → not assignable).
    await expect(
      page.locator('select[name="feeder_id"] option', { hasText: email }),
    ).toHaveCount(0);
  } finally {
    await svc
      .from("invitations")
      .delete()
      .eq("organisation_id", orgId!)
      .eq("email", email);
  }
});

test("caretaker does not see the inline invite affordance (admin-only)", async ({
  browser,
}) => {
  const ctx = await browser.newContext({
    storageState: "e2e/.auth/caretaker.json",
  });
  const page = await ctx.newPage();
  try {
    const { url } = await createColonyViaUI(page);
    await page.goto(`${url}/schedules/new`);
    await expect(
      page.getByRole("heading", { name: "Add schedule" }),
    ).toBeVisible();
    // The disclosure is absent for a caretaker — the form is unchanged.
    await expect(
      page.getByRole("button", { name: "Invite a new volunteer" }),
    ).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test("with an assignable feeder present, the schedule form still selects + saves (no regression)", async ({
  page,
}) => {
  const { orgId, users } = readRunState();
  const feeder = users.find((u) => u.role === "feeder")!;
  const svc = serviceClient();

  const { url } = await createColonyViaUI(page);
  const colonyId = url.split("/app/colonies/")[1]?.split(/[?#]/)[0];

  await page.goto(`${url}/schedules/new`);
  await page.getByLabel("Feeder").selectOption(feeder.id);
  // Weekly is the default; toggle all weekdays so it always matches "today".
  const dayButtons = page
    .getByRole("group", { name: "Repeats on" })
    .getByRole("button");
  const count = await dayButtons.count();
  for (let i = 0; i < count; i++) await dayButtons.nth(i).click();
  await page.getByRole("button", { name: "Save schedule" }).click();
  await page.waitForURL(/\/app\/colonies\/[0-9a-f-]+(\?|$)/);

  const { data } = await svc
    .from("feeding_schedules")
    .select("id, feeder_id")
    .eq("organisation_id", orgId!)
    .eq("colony_id", colonyId!)
    .is("deleted_at", null);
  expect(data?.length).toBe(7);
  expect(data?.every((r) => r.feeder_id === feeder.id)).toBe(true);
});
