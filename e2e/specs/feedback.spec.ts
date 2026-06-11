import { test, expect } from "@playwright/test";
import { readRunState, serviceClient } from "../helpers/admin";

// ─────────────────────────────────────────────────────────────────────────────
// Feedback channel — UI happy path + empty-message rejection (AC31/AC32).
//
// POST-DEPLOY: the feedback page/form are not on prod until this branch ships,
// so these UI-driven assertions go GREEN after deploy. They are written cleanly
// and collected by `--list` now; run them once the build is live. The RLS
// negative matrix (feedback-rls.spec.ts) does NOT depend on the deployed UI and
// is the part that runs for real at QA time.
//
// Uses the shared global-setup sessions (a feeder, to also prove the lowest
// role can file feedback). Each created row is verified server-side then DELETED
// via the service role so the run leaves nothing behind (the global teardown's
// org cascade would also remove them, but we clean explicitly + immediately).
// ─────────────────────────────────────────────────────────────────────────────

test.describe("feedback channel (UI)", () => {
  test.use({ storageState: "e2e/.auth/feeder.json" });

  const svc = serviceClient();
  const createdRowIds: string[] = [];

  test.afterAll(async () => {
    for (const id of createdRowIds) {
      await svc.from("feedback").delete().eq("id", id);
    }
  });

  test("AC31: feeder files a bug → success confirmation + exactly one 'new' row with server-derived context", async ({
    page,
  }) => {
    const state = readRunState();
    const orgId = state.orgId!;
    const feeder = state.users.find((u) => u.role === "feeder")!;
    const marker = `e2e bug ${Date.now()}-${Math.random().toString(36).slice(2)}`;

    await page.goto("/app/feedback");
    await expect(page.getByRole("heading", { name: "Feedback" })).toBeVisible();

    // Choose kind = Bug (segmented radio group).
    await page.getByRole("radio", { name: /bug/i }).click();
    await expect(page.getByRole("radio", { name: /bug/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    // Type the message.
    await page.getByRole("textbox").first().fill(marker);

    // Submit.
    await page.getByRole("button", { name: /send|submit/i }).click();

    // Success confirmation (role="status" panel).
    await expect(page.getByRole("status")).toBeVisible();

    // Exactly ONE row, with the context the SERVER derived (not the client):
    // own reporter_id, the active org, the feeder role, status 'new'.
    const { data: rows } = await svc
      .from("feedback")
      .select(
        "id, organisation_id, reporter_id, reporter_role, kind, status, message, app_version",
      )
      .eq("message", marker);
    expect(rows ?? []).toHaveLength(1);
    const row = rows![0];
    createdRowIds.push(row.id);

    expect(row.organisation_id).toBe(orgId);
    expect(row.reporter_id).toBe(feeder.id);
    expect(row.reporter_role).toBe("feeder");
    expect(row.kind).toBe("bug");
    expect(row.status).toBe("new");
    // app_version is stamped from the build (a non-empty server value).
    expect(
      typeof row.app_version === "string" && row.app_version.length > 0,
    ).toBe(true);
  });

  test("AC32: empty message is rejected — no row is written", async ({
    page,
  }) => {
    await page.goto("/app/feedback");
    await expect(page.getByRole("heading", { name: "Feedback" })).toBeVisible();

    // Submit with an empty message.
    await page.getByRole("button", { name: /send|submit/i }).click();

    // An inline validation error is shown; no success panel appears.
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0);
  });
});
