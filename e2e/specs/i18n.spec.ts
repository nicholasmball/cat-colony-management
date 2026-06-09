import { expect, test } from "@playwright/test";

// ─────────────────────────────────────────────────────────────────────────────
// i18n: toggle the EN|PT switcher to Portuguese and assert key nav + page labels
// render the real PT strings (NOT raw i18n keys) — the direct guard for the bug
// that shipped earlier — then toggle back to EN. We act in a private context so
// the locale-cookie flip never leaks into the shared admin session other specs
// reuse. Desktop sidebar (default viewport) carries the switcher + nav labels.
// ─────────────────────────────────────────────────────────────────────────────

test("switching to PT localises nav + page labels, then back to EN", async ({
  browser,
}) => {
  const ctx = await browser.newContext({
    storageState: "e2e/.auth/admin.json",
  });
  const page = await ctx.newPage();
  await page.goto("/app/today");

  // Baseline EN: the sidebar nav shows English labels.
  const nav = page.getByRole("navigation").first();
  await expect(nav.getByText("Colonies", { exact: true })).toBeVisible();

  // ── Flip to PT via the EN|PT radiogroup ──
  await page.getByRole("radio", { name: "Português" }).click();
  // The action revalidates; wait for the PT nav label to appear.
  await expect(nav.getByText("Colónias", { exact: true })).toBeVisible();

  // Nav is Portuguese, not raw keys.
  await expect(nav.getByText("Hoje", { exact: true })).toBeVisible();
  await expect(page.getByText(/nav\./)).toHaveCount(0);

  // A page title is localised too — the alerts page labels (the bug surface).
  await page.goto("/app/alerts");
  await expect(
    page.getByRole("heading", { name: "Limites de alerta" }),
  ).toBeVisible();
  await expect(
    page.getByText("Dias até um gato", { exact: false }),
  ).toBeVisible();
  // No raw namespaced keys leak through in PT either.
  await expect(page.getByText(/alertSettings\./)).toHaveCount(0);

  // ── Toggle back to EN ──
  await page.getByRole("radio", { name: "English" }).click();
  await expect(
    page.getByRole("heading", { name: "Alert thresholds" }),
  ).toBeVisible();

  await ctx.close();
});
