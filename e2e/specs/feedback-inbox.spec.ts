import { test, expect } from "@playwright/test";
import { readRunState, serviceClient } from "../helpers/admin";

// ─────────────────────────────────────────────────────────────────────────────
// Admin Feedback Inbox (read-only) — admin sees the team's submissions; a feeder
// is denied the route (same server-side gate as Members/Org).
//
// POST-DEPLOY: the inbox route is not on prod until this branch ships, so the
// admin UI-driven assertions go GREEN after deploy (mirrors feedback.spec.ts).
// The seed + teardown DO run for real now via the service role.
//
// We seed feedback rows directly with the service role (the inbox itself reads
// via the service role server-side, since RLS only exposes a member's OWN rows).
// Every seeded row id is recorded and DELETED in afterAll — same teardown
// discipline as the rest of the suite (the org cascade would also remove them).
// ─────────────────────────────────────────────────────────────────────────────

const svc = serviceClient();
const createdRowIds: string[] = [];

test.afterAll(async () => {
  for (const id of createdRowIds) {
    await svc.from("feedback").delete().eq("id", id);
  }
});

test.describe("feedback inbox — admin can read the team's submissions", () => {
  test.use({ storageState: "e2e/.auth/admin.json" });

  test("admin sees a service-role-seeded feedback row with its full context", async ({
    page,
  }) => {
    const state = readRunState();
    const orgId = state.orgId!;
    // Attribute the seeded row to the feeder — proving the admin reads ACROSS
    // members (RLS would hide a feeder's row from the admin's own client).
    const feeder = state.users.find((u) => u.role === "feeder")!;
    const marker = `e2e inbox bug ${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const { data: seeded, error } = await svc
      .from("feedback")
      .insert({
        organisation_id: orgId,
        reporter_id: feeder.id,
        reporter_role: "feeder",
        kind: "bug",
        message: marker,
        page_url: "/app/today",
        locale: "en",
        app_version: "a1f9c20e3b4d5f6a7b8c9d0e1f2a3b4c5d6e7f80",
        status: "new",
      })
      .select("id")
      .single();
    expect(error, error?.message).toBeNull();
    createdRowIds.push(seeded!.id);

    await page.goto("/app/feedback/inbox");
    await expect(page).toHaveURL(/\/app\/feedback\/inbox/);
    await expect(
      page.getByRole("heading", { name: /feedback inbox/i }),
    ).toBeVisible();

    // The seeded message renders in full (never truncated).
    await expect(page.getByText(marker)).toBeVisible();
    // Kind + status badges render.
    await expect(page.getByText("Bug").first()).toBeVisible();
    await expect(page.getByText("New").first()).toBeVisible();
    // The short build SHA (first 7 chars of the 40-char SHA) renders.
    await expect(page.getByText("a1f9c20").first()).toBeVisible();
  });

  test("admin reaches the inbox via the form's 'View submitted feedback' link", async ({
    page,
  }) => {
    await page.goto("/app/feedback");
    await page.getByRole("link", { name: /view submitted feedback/i }).click();
    await expect(page).toHaveURL(/\/app\/feedback\/inbox/);
  });
});

test.describe("feedback inbox — non-admin is denied", () => {
  test.use({ storageState: "e2e/.auth/feeder.json" });

  test("feeder visiting /app/feedback/inbox is bounced away", async ({
    page,
  }) => {
    await page.goto("/app/feedback/inbox");
    // Same observable behaviour as the other admin-gated pages (Members/Org):
    // a feeder never stays on the route; they land back on /app(/today).
    await expect(page).not.toHaveURL(/\/app\/feedback\/inbox/);
    await expect(page).toHaveURL(/\/app(\/today)?(\/|$|\?)/);
  });

  test("feeder does NOT see the 'View submitted feedback' link on the form", async ({
    page,
  }) => {
    await page.goto("/app/feedback");
    await expect(page.getByRole("heading", { name: "Feedback" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /view submitted feedback/i }),
    ).toHaveCount(0);
  });
});
