import { test, expect } from "@playwright/test";
import { readRunState, serviceClient } from "../helpers/admin";

// ─────────────────────────────────────────────────────────────────────────────
// Admin Feedback RESOLVE — an admin resolves a team member's feedback from the
// inbox; the row persists status/resolved_by/resolved_at + the optional note,
// and a best-effort in-app notification is created for the reporter (the feeder).
// A feeder cannot reach the action (same admin gate as the inbox itself).
//
// POST-DEPLOY + POST-MIGRATION: this goes GREEN only after 0012_feedback_resolve
// is applied (the resolved_* columns + the notif_type 'feedback_resolved' value)
// AND this branch is deployed to prod (the inbox + action aren't live until then)
// — mirrors feedback-inbox.spec.ts. The seed + teardown run for real now.
//
// We seed the feedback row with the service role (the inbox reads + the action
// writes via the service role; RLS only exposes a member's OWN rows). Every
// seeded feedback row id AND the reporter notification are recorded + DELETED in
// afterAll — same teardown discipline as the rest of the suite.
// ─────────────────────────────────────────────────────────────────────────────

const svc = serviceClient();
const createdFeedbackIds: string[] = [];

test.afterAll(async () => {
  // Remove the reporter notifications first, then the feedback rows.
  for (const id of createdFeedbackIds) {
    await svc
      .from("notifications")
      .delete()
      .eq("dedup_key", `feedback_resolved:${id}`);
    await svc.from("feedback").delete().eq("id", id);
  }
});

test.describe("feedback resolve — admin resolves a team member's report", () => {
  test.use({ storageState: "e2e/.auth/admin.json" });

  test("admin resolves a seeded feedback row → persisted + reporter notified", async ({
    page,
  }) => {
    const state = readRunState();
    const orgId = state.orgId!;
    const admin = state.users.find((u) => u.role === "admin")!;
    const feeder = state.users.find((u) => u.role === "feeder")!;
    const marker = `e2e resolve bug ${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const note = `Fixed in the next build — thanks! ${Date.now()}`;

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
        status: "new",
      })
      .select("id")
      .single();
    expect(error, error?.message).toBeNull();
    const feedbackId = seeded!.id as string;
    createdFeedbackIds.push(feedbackId);

    await page.goto("/app/feedback/inbox");
    await expect(page.getByText(marker)).toBeVisible();

    // Expand the inline confirm, add the optional note, mark resolved.
    await page
      .getByRole("button", { name: /resolve/i })
      .first()
      .click();
    await page.getByLabel(/resolution note/i).fill(note);
    await page.getByRole("button", { name: /mark resolved/i }).click();

    // The row flips to its terminal Resolved state (badge + who/when).
    await expect(page.getByText("Resolved").first()).toBeVisible();

    // DB: the resolve fields persisted.
    const { data: row } = await svc
      .from("feedback")
      .select("status, resolved_by, resolved_at, resolution_note")
      .eq("id", feedbackId)
      .single();
    expect(row?.status).toBe("resolved");
    expect(row?.resolved_by).toBe(admin.id);
    expect(row?.resolved_at).not.toBeNull();
    expect(row?.resolution_note).toBe(note);

    // DB: a best-effort in-app notification was created for the reporter (feeder).
    const { data: notif } = await svc
      .from("notifications")
      .select("recipient_id, type, severity, dedup_key")
      .eq("dedup_key", `feedback_resolved:${feedbackId}`)
      .maybeSingle();
    expect(notif?.recipient_id).toBe(feeder.id);
    expect(notif?.type).toBe("feedback_resolved");
    expect(notif?.severity).toBe("routine");
  });
});

test.describe("feedback resolve — non-admin is denied", () => {
  test.use({ storageState: "e2e/.auth/feeder.json" });

  test("feeder cannot reach the inbox (so cannot resolve)", async ({
    page,
  }) => {
    await page.goto("/app/feedback/inbox");
    // Same observable behaviour as the other admin-gated pages: the feeder never
    // stays on the route, so the Resolve action is unreachable. The server action
    // additionally re-checks the admin gate (unit-covered) as the trust boundary.
    await expect(page).not.toHaveURL(/\/app\/feedback\/inbox/);
    await expect(page).toHaveURL(/\/app(\/today)?(\/|$|\?)/);
  });
});
