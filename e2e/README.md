# E2E test harness (Playwright)

End-to-end smoke tests for the SCoT Colony Management app, driven through the
real UI with Playwright.

## Run

```bash
npm run e2e         # headless, against PRODUCTION
npm run e2e:ui      # Playwright UI mode
```

The HTML report lands in `playwright-report/` (gitignored). Open it with
`npx playwright show-report`.

## Target

By default the suite runs against **production**:
`https://cat-colony-management.vercel.app`. Override with `E2E_BASE_URL`:

```bash
E2E_BASE_URL=http://localhost:3000 npm run e2e
```

## Environment

Secrets are loaded from **`.env.e2e`** (gitignored) by `playwright.config.ts`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

The service-role key is used **only** on the node side (global setup/teardown
and fixtures) to provision and tear down test data. It is never exposed to the
browser.

## Safety model (running against the live DB)

This suite writes to the live database, so it is built to be strictly isolated
and self-cleaning:

- **Throwaway org per run.** `global-setup.ts` creates a uniquely-named org
  (`E2E <ISO-timestamp>-<short-uuid>`) via the same `create_organisation` RPC
  the app uses, plus one user per role
  (`e2e+<uuid>@scot-e2e.invalid` — the reserved `.invalid` TLD can never collide
  with a real volunteer). All created IDs are persisted to
  `e2e/.run-state.json` (gitignored).
- **Only ever touches what this run created.** No pre-existing org, user, or
  row is read, modified, or deleted.
- **Verified teardown.** `global-teardown.ts` deletes the test org (which
  cascades to its colonies/cats/feeding/incidents/notifications/memberships) and
  every auth user, then **verifies via the service role that they are gone** and
  logs the result. The run-state file is only removed once the cleanup is
  confirmed clean.

## What's covered (smoke set)

- `auth.spec.ts` — a saved session loads `/app` authenticated; an
  unauthenticated context is redirected to `/login`.
- `colonies.spec.ts` — create a colony via the UI; it appears in the list and
  on its detail page.
- `feeding.spec.ts` — submit a "fed" feeding update; success toast, and the
  `feeding_events` row is verified via the service role (scoped to the test
  org).
- `incidents.spec.ts` — report an incident, then triage it (Start → Resolve)
  and confirm the resolved state in the DB.

Authenticated specs reuse the **admin** `storageState` captured during global
setup (`e2e/.auth/admin.json`, gitignored). Caretaker and feeder sessions are
also captured for future role-scoped tests.

## Not in CI

`npm run e2e` is intentionally **not** part of the CI build job: it writes to
production and needs the service-role secret. Run it manually.
