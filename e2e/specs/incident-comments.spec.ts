import { expect, test } from "@playwright/test";
import { readRunState, serviceClient } from "../helpers/admin";
import { createColonyViaUI } from "../helpers/ui";

// ─────────────────────────────────────────────────────────────────────────────
// Incident comment thread + the role rail around it. incidents.spec.ts proves
// the manager triage path (Start → Resolve); this proves the OTHER documented
// rule (SCoT round-2 decision): "reporting Feeder can comment but NOT resolve."
//   • a feeder reports an incident, then posts a comment on it → the note
//     persists (incident_comments row) and renders in the thread,
//   • the feeder sees NO manager action panel — no "Manage incident", no
//     Start / Mark-resolved controls — so they genuinely cannot resolve,
//   • an admin viewing the same incident sees the feeder's comment AND the
//     manager action panel (the controls the feeder was denied).
//
// All rows live in the throwaway per-run org (teardown's cascade cleans up). The
// admin creates the colony; the feeder acts in its own captured context.
// ─────────────────────────────────────────────────────────────────────────────

test("a feeder can comment on an incident but cannot resolve it; an admin can manage it", async ({
  page,
  browser,
}) => {
  const { url } = await createColonyViaUI(page);
  const colonyId = url.split("/app/colonies/")[1]?.split(/[?#]/)[0];
  expect(colonyId).toBeTruthy();

  // ── Feeder reports an incident and opens it ──
  const feederCtx = await browser.newContext({
    storageState: "e2e/.auth/feeder.json",
  });
  const feederPage = await feederCtx.newPage();
  await feederPage.goto(`${url}/incidents/new`);
  await expect(
    feederPage.getByRole("heading", { name: "Report an incident" }),
  ).toBeVisible();
  await feederPage.getByRole("radio", { name: "Sick / injured" }).click();
  await feederPage.getByRole("button", { name: /report/i }).click();
  await feederPage.waitForURL(/\/app\/colonies\/[0-9a-f-]+\?reported=/);

  // Resolve the incident id from the test org + this colony.
  const { orgId } = readRunState();
  const svc = serviceClient();
  const { data: incidents } = await svc
    .from("incidents")
    .select("id, status")
    .eq("organisation_id", orgId!)
    .eq("colony_id", colonyId!);
  expect(incidents?.length).toBe(1);
  const incidentId = incidents![0].id as string;
  expect(incidents![0].status).toBe("open");

  // ── Feeder posts a comment ──
  await feederPage.goto(`/app/incidents/${incidentId}`);
  await expect(
    feederPage.getByRole("heading", { name: /Sick \/ injured/ }),
  ).toBeVisible();

  // The feeder must NOT see any manager controls — that's the "can't resolve"
  // rail. Assert their absence BEFORE we comment so a regression can't hide.
  await expect(feederPage.getByText("Manage incident")).toHaveCount(0);
  await expect(feederPage.getByRole("button", { name: /Start/ })).toHaveCount(
    0,
  );
  await expect(
    feederPage.getByRole("button", { name: /Mark resolved/ }),
  ).toHaveCount(0);

  // The comment form IS available to the feeder; post a note.
  const note = `E2E feeder note ${Date.now()}`;
  await feederPage.getByPlaceholder("Add a note…").fill(note);
  await feederPage.getByRole("button", { name: "Post note" }).click();

  // The note persists in the thread (poll the DB — the post redirects back to
  // the same incident page, so waitForURL would race the write).
  await expect
    .poll(async () => {
      const { data } = await svc
        .from("incident_comments")
        .select("id, body, author_id")
        .eq("incident_id", incidentId);
      return data ?? [];
    })
    .toEqual([
      expect.objectContaining({ body: note, author_id: expect.any(String) }),
    ]);

  // And it renders in the feeder's thread.
  await feederPage.goto(`/app/incidents/${incidentId}`);
  await expect(feederPage.getByText(note)).toBeVisible();
  // The incident is STILL open — the feeder never resolved it.
  const { data: stillOpen } = await svc
    .from("incidents")
    .select("status")
    .eq("id", incidentId)
    .single();
  expect(stillOpen?.status).toBe("open");

  await feederCtx.close();

  // ── Admin sees the feeder's note AND the manager action panel ──
  await page.goto(`/app/incidents/${incidentId}`);
  await expect(page.getByText(note)).toBeVisible();
  await expect(page.getByText("Manage incident")).toBeVisible();
  // The manager controls the feeder was denied are present for the admin.
  await expect(page.getByRole("button", { name: /Start/ })).toBeVisible();
});
