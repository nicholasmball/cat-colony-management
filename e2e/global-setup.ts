import { chromium, type FullConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";
import {
  addMembership,
  AUTH_DIR,
  createTestOrg,
  createTestUser,
  serviceClient,
  storageStatePath,
  writeRunState,
  type CreatedUser,
  type Role,
} from "./helpers/admin";

// ─────────────────────────────────────────────────────────────────────────────
// Global setup: provision a throwaway org + one user per role, log each in via
// the real login form (so the captured storageState is a genuine Supabase
// session), and persist every created ID for teardown.
//
// SAFETY: only IDs created here are ever written to .run-state.json; teardown
// deletes exactly that set. Nothing pre-existing is touched.
// ─────────────────────────────────────────────────────────────────────────────

export default async function globalSetup(config: FullConfig) {
  const baseURL =
    config.projects[0]?.use.baseURL ??
    "https://cat-colony-management.vercel.app";
  const svc = serviceClient();

  // Persist incrementally so a failure mid-setup still leaves teardown enough to
  // clean up whatever was created.
  const state: {
    orgId: string | null;
    orgName: string | null;
    users: CreatedUser[];
  } = { orgId: null, orgName: null, users: [] };

  try {
    // 1) Admin user → owns the throwaway org (created via the same RPC the app
    //    uses, so it lands in the org with an admin membership + seeded defaults).
    const admin = await createTestUser(svc, "admin");
    state.users.push(admin);
    writeRunState(state);

    const { orgId, orgName } = await createTestOrg(admin);
    state.orgId = orgId;
    state.orgName = orgName;
    writeRunState(state);

    // 2) Caretaker + feeder join the same org (for later role-scoped tests).
    for (const role of ["caretaker", "feeder"] as Role[]) {
      const user = await createTestUser(svc, role);
      await addMembership(svc, orgId, user.id, role);
      state.users.push(user);
      writeRunState(state);
    }

    // 3) Log each user in through the real form and save storageState per role.
    mkdirSync(AUTH_DIR, { recursive: true });
    const browser = await chromium.launch();
    try {
      for (const user of state.users) {
        const context = await browser.newContext({ baseURL });
        // Force English so specs can assert on stable EN labels regardless of
        // the runner's Accept-Language (cookie wins per i18n/request.ts).
        await context.addCookies([
          {
            name: "locale",
            value: "en",
            url: baseURL,
          },
        ]);
        const page = await context.newPage();
        await page.goto("/login");
        await page.getByLabel("Email").fill(user.email);
        await page.getByLabel("Password").fill(user.password);
        await page.getByRole("button", { name: "Sign in" }).click();
        // The login action redirects to /app; wait for an authenticated landing.
        await page.waitForURL(/\/app(\/|$|\?)/, { timeout: 30_000 });
        await context.storageState({ path: storageStatePath(user.role) });
        await context.close();
      }
    } finally {
      await browser.close();
    }

    console.log(
      `[e2e setup] org=${orgName} (${orgId}); users=${state.users
        .map((u) => `${u.role}:${u.email}`)
        .join(", ")}`,
    );
  } catch (err) {
    // Leave run-state on disk so teardown can clean up partial provisioning.
    console.error("[e2e setup] failed:", err);
    throw err;
  }
}
