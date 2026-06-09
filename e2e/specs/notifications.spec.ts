import { expect, test } from "@playwright/test";
import { readRunState, serviceClient } from "../helpers/admin";
import { createColonyViaUI } from "../helpers/ui";

// ─────────────────────────────────────────────────────────────────────────────
// Notifications. A feeder reports an URGENT incident (urgency level "Urgent" →
// alerts_immediately), which fans a notification row to every caretaker/admin.
// The admin recipient then:
//   • sees the alert in /app/notifications (with an "Urgent" severity chip),
//   • sees the unread badge reflect it,
//   • marks one read, then marks all read.
// All rows live in the throwaway org (cascade-cleaned). The colony is created by
// the admin; the feeder reports from its own context.
// ─────────────────────────────────────────────────────────────────────────────

test("urgent incident notifies the admin; mark-read flows work", async ({
  page,
  browser,
}) => {
  const { url } = await createColonyViaUI(page);
  const colonyId = url.split("/app/colonies/")[1]?.split(/[?#]/)[0];
  expect(colonyId).toBeTruthy();

  // ── Feeder reports an URGENT incident (poisoning + Urgent level) ──
  const feederCtx = await browser.newContext({
    storageState: "e2e/.auth/feeder.json",
  });
  const feederPage = await feederCtx.newPage();
  await feederPage.goto(`${url}/incidents/new`);
  await expect(
    feederPage.getByRole("heading", { name: "Report an incident" }),
  ).toBeVisible();
  await feederPage.getByRole("radio", { name: "Poisoning" }).click();
  // Make it urgent: pick the "Urgent" urgency level (alerts_immediately).
  await feederPage.getByRole("radio", { name: "Urgent", exact: true }).click();
  await feederPage
    .getByRole("textbox")
    .first()
    .fill("E2E urgent: suspected poison bait");
  await feederPage.getByRole("button", { name: /report/i }).click();
  await feederPage.waitForURL(/\/app\/colonies\/[0-9a-f-]+\?reported=urgent/);
  await feederCtx.close();

  // The alert row exists for the admin recipient (service-role confirms intent).
  const { orgId, users } = readRunState();
  const admin = users.find((u) => u.role === "admin")!;
  const svc = serviceClient();
  await expect
    .poll(async () => {
      const { data } = await svc
        .from("notifications")
        .select("id, severity, type")
        .eq("organisation_id", orgId!)
        .eq("recipient_id", admin.id)
        .eq("colony_id", colonyId!);
      return data?.length ?? 0;
    })
    .toBeGreaterThan(0);

  // ── Admin sees it in /app/notifications, unread, urgent ──
  await page.goto("/app/notifications");
  await expect(
    page.getByRole("heading", { name: "Notifications" }),
  ).toBeVisible();
  // The urgent severity chip renders.
  await expect(page.getByText("Urgent", { exact: true }).first()).toBeVisible();
  // The unread subtitle reflects ≥1 unread.
  await expect(page.getByText(/unread/)).toBeVisible();
  // Mark-all-read control is shown only when there are unread rows.
  const markAll = page.getByRole("button", { name: "Mark all read" });
  await expect(markAll).toBeVisible();

  // Helper: count this admin's UNREAD notifications in the test org.
  const unreadCount = async () => {
    const { data } = await svc
      .from("notifications")
      .select("id")
      .eq("organisation_id", orgId!)
      .eq("recipient_id", admin.id)
      .is("read_at", null);
    return data?.length ?? 0;
  };
  const before = await unreadCount();
  expect(before).toBeGreaterThan(0);

  // ── Mark ONE read (the per-row check button) ──
  // The action redirects back to /app/notifications (where we already are), so
  // waitForURL would race the write — poll the DB for the unread count to drop.
  await page
    .getByRole("button", { name: /Mark .* as read/ })
    .first()
    .click();
  await expect.poll(unreadCount).toBeLessThan(before);

  // ── Mark ALL read ──
  await page.goto("/app/notifications");
  const markAll2 = page.getByRole("button", { name: "Mark all read" });
  if (await markAll2.isVisible().catch(() => false)) {
    await markAll2.click();
  }
  await expect.poll(unreadCount).toBe(0);

  // The UI now shows the all-caught-up state on a fresh load.
  await page.goto("/app/notifications");
  await expect(
    page.getByText("You’re all caught up", { exact: false }),
  ).toBeVisible();
});
