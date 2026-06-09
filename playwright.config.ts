import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { storageStatePath } from "./e2e/helpers/admin";

// Secrets (Supabase URL/anon/service-role) live in .env.e2e (gitignored).
loadEnv({ path: ".env.e2e" });

// PROD by default; overridable for local/preview runs.
const baseURL =
  process.env.E2E_BASE_URL ?? "https://cat-colony-management.vercel.app";

export default defineConfig({
  testDir: "./e2e/specs",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL,
    headless: true,
    trace: "retain-on-failure",
    // Authenticated specs reuse the admin session captured in global setup.
    storageState: storageStatePath("admin"),
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
