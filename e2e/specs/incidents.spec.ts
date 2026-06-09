import { expect, test } from "@playwright/test";
import { readRunState, serviceClient } from "../helpers/admin";
import { createColonyViaUI } from "../helpers/ui";

// Report an incident via the UI → it persists and shows; then (as admin) triage
// it through Start → Resolve and confirm the resolved state.
test("report an incident, then triage and resolve it", async ({ page }) => {
  const { url } = await createColonyViaUI(page);
  const colonyId = url.split("/app/colonies/")[1]?.split(/[?#]/)[0];
  expect(colonyId).toBeTruthy();

  // ── Report ──
  await page.goto(`${url}/incidents/new`);
  await expect(
    page.getByRole("heading", { name: "Report an incident" }),
  ).toBeVisible();
  // Type is required — pick "Sick / injured" (a danger type tile). Notes are
  // optional, so type alone is enough to submit.
  await page.getByRole("radio", { name: "Sick / injured" }).click();
  await page.getByRole("textbox").fill("E2E injured cat near the wall");
  await page.getByRole("button", { name: /report/i }).click();

  // Navigates back to the colony with a reported flag + toast.
  await page.waitForURL(/\/app\/colonies\/[0-9a-f-]+\?reported=/);
  await expect(page.getByText(/Incident reported/)).toBeVisible();

  // Resolve the incident id from the throwaway org + this colony only.
  const { orgId } = readRunState();
  const svc = serviceClient();
  const { data: incidents, error } = await svc
    .from("incidents")
    .select("id, type, status")
    .eq("organisation_id", orgId!)
    .eq("colony_id", colonyId!);
  expect(error).toBeNull();
  expect(incidents?.length).toBe(1);
  const incidentId = incidents![0].id as string;
  expect(incidents![0].status).toBe("open");

  // ── Triage (admin) ──
  await page.goto(`/app/incidents/${incidentId}`);
  await expect(
    page.getByRole("heading", { name: /Sick \/ injured/ }),
  ).toBeVisible();
  // Manager action panel is present for admins.
  await expect(page.getByText("Manage incident")).toBeVisible();

  // Start → in_progress.
  await page.getByRole("button", { name: /Start/ }).click();
  await page.waitForLoadState("networkidle");

  // Resolve: expand the inline note box, fill the required note, confirm.
  await page.getByRole("button", { name: /Mark resolved/ }).click();
  const resolutionNote = "E2E: cat collected and taken to the vet.";
  await page.getByPlaceholder(/How was this resolved/).fill(resolutionNote);
  await page.getByRole("button", { name: /Resolve incident/ }).click();
  await page.waitForLoadState("networkidle");

  // Resolution summary renders the note we entered; DB reflects resolved status.
  await expect(page.getByText(resolutionNote)).toBeVisible();
  const { data: after } = await svc
    .from("incidents")
    .select("status, resolution_note")
    .eq("id", incidentId)
    .single();
  expect(after?.status).toBe("resolved");
  expect(after?.resolution_note).toContain("E2E");
});
