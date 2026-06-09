# Offline-first sync (PWA) — Implementation Plan & Rollback Runbook

**Status:** step 2 of 5 — Implementation Plan, awaiting Human Deploy-gate approval.
**Builds on:** the approved Requirements & Impact Assessment (Option C).
**Owner of execution:** Full-Stack engineer.
**Persona of this doc:** DevOps/infra — reliable, observable, reversible. Every phase is independently shippable, CI-green, and individually revertible. **Ship phase-by-phase PRs, not one mega-PR.**

---

## 0. Ground truth (re-verified against the codebase)

The three field writes and their transport today:

| Write           | Server action                                                    | Form component                   | Tables written                                      |
| --------------- | ---------------------------------------------------------------- | -------------------------------- | --------------------------------------------------- |
| Feeding update  | `submitFeeding` in `app/app/colonies/actions.ts`                 | `components/feed-form.tsx`       | `feeding_events` (1) + `cat_sightings` (N)          |
| Cat report      | `reportCat` in `app/app/colonies/[id]/cats/report/actions.ts`    | `components/cat-report-form.tsx` | `cats` (1, `status='new_unconfirmed'`)              |
| Incident report | `createIncident` in `app/app/colonies/[id]/incidents/actions.ts` | `components/incident-form.tsx`   | `incidents` (1) + `attachments` (0–1, online photo) |

Key facts that shape the plan (verified):

- **No migration needed.** `cats`, `feeding_events`, `cat_sightings`, `incidents`, `attachments` all have `id uuid primary key default gen_random_uuid()` (`supabase/migrations/0002_domain.sql`). A **client-supplied UUID inserted into the PK** + `upsert(..., { onConflict: 'id', ignoreDuplicates: true })` gives idempotent replays for free — no schema change, no new unique constraint.
- **RLS insert policies are membership-scoped, not `auth.uid()`-write-checked** (`supabase/migrations/0003_rls.sql`: `insert cats`, `members insert feeding_events`, `members insert cat_sightings`, `members insert incidents`, `members insert attachments`). So the route handlers can use the **RLS-bound `createClient()`** for the inserts exactly as the server actions do today. (Note: the manager _update_/_archive_ paths in `colonies/actions.ts` use the service-role client because `auth.uid()` is unreliable in that write context — that is **not** the case for these three inserts, which already use the RLS-bound client and work. Do not "fix" what isn't broken.)
- **Alert hooks must stay server-side.** All three actions fan alerts via `createServiceClient()` (`lib/supabase/service.ts`, SERVER-ONLY, service-role key) into `lib/alert-engine` + `lib/alert-recipients` + `lib/alert-persist`. This logic moves verbatim into the route handlers and **never** crosses to the client.
- **Photos are online-only in v1.** Both the incident and cat-report forms presign → `PUT` to R2 from the browser (`app/api/photos/presign/route.ts`, colony-scoped keys), then pass `photo_key`. The outbox carries **no binary**; an offline submit simply has no `photo_key` (same non-blocking "photo failed" contract already in the code).
- **Manifest + icons already exist:** `public/manifest.webmanifest`, `public/icon-192.png`, `public/icon-512.png`, wired in `app/layout.tsx` (`manifest`, `appleWebApp`, `themeColor`). Phase 0 is therefore _mostly verification + EN/PT name + the kill-switch_, not greenfield.
- **No service worker exists yet.** `middleware.ts` matcher already excludes `.webmanifest`/static. There is **nothing to roll back at the SW layer today** — which is exactly why the kill-switch must land _before_ any caching SW.
- **Test runner:** `node --test` over `lib/**/*.test.ts`, `i18n/**`, `messages/**` (`package.json`). Keep all new logic in `lib/` so it is node:test-able with **no new runner**.

---

## 1. The 7 decisions for the Human Deploy gate (the approve-list)

Re-stated from the assessment so the human can approve in one place:

1. **Transport = Option C.** Convert the 3 field writes to JSON API **route handlers** + an **IndexedDB outbox** + a **Serwist** service worker. (Not: server-action-over-SW, not a heavier sync engine.)
2. **Photos out of scope for v1 offline.** Online-only upload; an offline submit saves the record with no photo and reuses the existing non-blocking "photo failed" copy.
3. **Read-cache scope = minimal.** Precache the app shell; runtime SWR for _last-viewed_ colony/cat GET pages only. **Never** serve stale RSC/data for write pages or dashboards.
4. **Edits/triage stay online-only.** Only the 3 _create_ writes go through the outbox. Cat confirm/reject, incident resolve, colony/cat edits, role changes remain online server actions.
5. **Kill-switch-first gating.** Phase 0 lands the self-unregistering kill-switch SW + runbook **before** any caching SW ships. All SW behaviour sits behind `NEXT_PUBLIC_SW_ENABLED`.
6. **Auth-expiry behaviour.** Flush does `refreshSession()` first; on a hard auth failure the item is marked `failed` (not dropped, not infinitely retried) and surfaced in the UI for a manual retry after the user re-authenticates. Items are **never** silently lost.
7. **Alert hooks stay server-side.** The service-role alert fan-out moves into the route handlers unchanged; it never runs in the SW/client.

**New decision this plan surfaces (needs a yes/no):**

8. **Phase-by-phase PRs, not one PR.** _Recommended: yes._ Each phase is independently shippable + reversible; a mega-PR makes the kill-switch-first guarantee meaningless. Phases 0–2 are low-risk commits; **Phase 3 (the caching SW) is the only phase that can brick returning users** and gets the explicit Deploy gate + canary.

---

## 2. Phased implementation plan (file-level)

### Phase 0 — PWA shell hardening + kill-switch FIRST (safety before features)

**Goal:** make the rollback path exist and be deployable _before_ any caching SW. No offline writes yet. **Commit-only; no Deploy gate** (ships nothing that can trap a user — it only adds an _unregister_ SW that is inert until referenced).

Files:

- `public/sw-kill.js` — **NEW**. The kill-switch SW. On `install`: `self.skipWaiting()`. On `activate`: delete **all** caches (`caches.keys()` → `caches.delete`), `self.registration.unregister()`, then `clients.matchAll()` → `client.navigate(client.url)` to force a clean reload. This is the file we point the registration at to evict a poisoned SW. (Plain `.js` in `public/`, not bundled, so it is dead-simple and auditable.)
- `app/layout.tsx` — **EDIT**. Add a tiny client registration component (below) in `<head>`/end-of-`<body>`.
- `components/sw-register.tsx` — **NEW** client component. Behaviour driven by **two** env flags:
  - `NEXT_PUBLIC_SW_ENABLED !== "true"` → on load, if a SW is already registered, register `('/sw-kill.js')` (or call `getRegistrations()` → `unregister()`); i.e. **flag-off actively cleans up**.
  - `NEXT_PUBLIC_SW_KILL === "true"` → force-register `/sw-kill.js` regardless (the panic button — see runbook).
  - `NEXT_PUBLIC_SW_ENABLED === "true"` and not killed → register the real SW (`/sw.js`), wired in Phase 3. Until Phase 3 ships, `/sw.js` doesn't exist, so this branch is a no-op behind a flag that is `false` in all envs.
- `public/manifest.webmanifest` — **EDIT**. Add localized name handling: keep `name`/`short_name`, add `lang: "en"` and `dir: "ltr"`; document that PT users get the PT name via the existing next-intl-driven `<title>` (manifest itself stays EN — a single static manifest can't be per-locale without a route handler; if SCoT wants a PT manifest, add `app/manifest.ts` as a follow-up — **out of scope here**).
- `public/icon-192.png`, `public/icon-512.png` — **VERIFY** they are real PNGs of the SCoT logo at the right sizes (current ones are 546 B / 1880 B — likely placeholders). **Action item:** replace with proper-resolution maskable icons + add `icon-512-maskable.png` with safe padding. Asset task for design (Compass), not code.
- `.env.example` / Vercel env — **ADD** `NEXT_PUBLIC_SW_ENABLED` (default unset/`false`) and `NEXT_PUBLIC_SW_KILL` (default unset/`false`).

Tests (Phase 0):

- `lib/offline/sw-flags.ts` — **NEW** pure helper: `swMode({ enabled, kill })` → `'kill' | 'register' | 'cleanup'`. `lib/offline/sw-flags.test.ts` exhaustively covers the truth table. (Keeps the only branching logic in `lib/`, node:test-able; the React component is a thin caller.)
- Manual: install the PWA on Android + iOS from a preview deploy; confirm standalone launch + icon.

**Reversibility:** trivial — revert the PR. Nothing cached, nothing trapped. The kill-switch SW being present-but-unreferenced is harmless.

---

### Phase 1 — Write transport: 3 JSON route handlers (parallel path, online-only)

**Goal:** prove the transport. Forms `fetch()` JSON routes instead of posting server actions. **Old server actions stay intact** (parallel path) so the whole phase reverts by flipping the form `action` back. Still online-only — no queue yet.

New route handlers (each contains the **same** logic as its server action, but: accepts a **client UUID**, returns **JSON `{ ok, id }`** not `redirect`, and keeps the **service-role alert hook**):

- `app/api/feedings/route.ts` — **NEW**. `POST` body: `{ id, colonyId, fed, problem, foodIssue, danger, notes, sightings: [{ id, catId, status }] }`. Mirrors `submitFeeding`: `getActiveOrg` → RLS `createClient()` → `upsert` `feeding_events` with client `id` (`onConflict:'id', ignoreDuplicates:true`) → `upsert` `cat_sightings` with client `id`s → service-role concern-sighting alert hook (unchanged) → return `{ ok:true, id }`. Replays are no-ops (ignoreDuplicates).
- `app/api/cats/report/route.ts` — **NEW**. `POST` body: `{ id, colonyId, name, tempId, colour, sex, neutered, notes, photoKey? }`. Mirrors `reportCat`: identifier validation (`hasReportIdentifier`), cross-org colony re-validation, `isKeyInOrg` photo guard, `upsert` `cats` with client `id` → service-role new-cat alert hook → `{ ok:true, id }`.
- `app/api/incidents/route.ts` — **NEW**. `POST` body: `{ id, colonyId, type, urgencyLevelId?, catId?, notes, photoKey? }`. Mirrors `createIncident`: `isValidIncidentType`, urgency resolve/default, optional-cat re-validation, `upsert` `incidents` with client `id`, online attachment insert if `photoKey`, → service-role incident alert hook → `{ ok:true, id, urgent }`.

Shared helper:

- `lib/api/respond.ts` — **NEW** tiny helper to standardize `{ ok, id }` / `{ ok:false, error }` + status codes (401 no-org, 400 validation, 409→treated as success on dup, 200 ok). Pure, testable.

Form edits (online-only call, still no queue):

- `components/feed-form.tsx`, `components/cat-report-form.tsx`, `components/incident-form.tsx` — **EDIT**. Replace `<form action={serverAction}>` with an `onSubmit` that: mints `crypto.randomUUID()` for the record (and per-sighting), `fetch('POST', json)`, on `ok` `router.push` to the same success URL the action used (`?updated=1` / `?reported=cat` / `?reported=urgent|1`, preserving the `&photo=failed` contract). Keep the existing client-side validation. Photo presign/PUT flow is unchanged and still runs _before_ submit (online-only).

Tests (Phase 1) — **route-handler idempotency is the headline test**:

- Extract the pure shaping/validation into `lib/api/feeding-input.ts`, `lib/api/incident-input.ts`, `lib/api/cat-report-input.ts` (parse + validate FormData/JSON → typed insert payload, including the UUID passthrough). Unit-test these in `lib/api/*.test.ts` (node:test) — this is where idempotency-key handling, urgency defaulting, identifier validation, and `isKeyInOrg` gating get covered without a DB.
- The Supabase `upsert onConflict/ignoreDuplicates` call itself is thin glue in the route; covered by one manual/integration check: POST the same UUID twice → exactly one row, second returns ok.

**Reversibility:** revert the three form edits (point `action` back at the server actions). Routes are **additive** — leaving them deployed is harmless. CI green throughout (no new deps).

**Deploy gate:** light — this changes the live submit path of 3 forms. Recommend the human approves the deploy, with a quick smoke test of each form online. Easy revert.

---

### Phase 2 — IndexedDB outbox + flush logic (pure, in `lib/`)

**Goal:** offline durability. Online → POST direct (Phase 1 path). Offline or failed → enqueue; flush on `online` event + on app load/foreground. Idempotent via the client UUID from Phase 1. **iOS path lives here** (no Background Sync on iOS — flush on online/foreground is the iOS story).

New `lib/offline/` modules (split so the state machine is node:test-able with a **fake store**, per the constraint "core logic in testable lib/ modules"):

- `lib/offline/types.ts` — **NEW**. `OutboxItem` = `{ id (UUID = record id), kind: 'feeding'|'cat_report'|'incident', endpoint, body, status: 'pending'|'syncing'|'synced'|'failed', attempts, lastError?, createdAt, updatedAt }`.
- `lib/offline/outbox.ts` — **NEW**. **Pure state-machine** over an injected `Store` interface (`enqueue`, `list`, `get`, `update`, `remove`, `markSyncing`, `markSynced`, `markFailed`). No IndexedDB import here — takes a `Store` so tests pass a fake Map-backed store.
- `lib/offline/idb-store.ts` — **NEW**. The **only** IndexedDB-touching file: implements `Store` against `indexedDB` (one object store keyed by `id`). Thin, browser-only, not unit-tested (covered by manual + the pure tests above).
- `lib/offline/sync.ts` — **NEW**. `flush({ store, fetcher, refreshSession })`: for each `pending`/`failed` item → `markSyncing` → `refreshSession()` → `POST` → on 2xx **or** the dup/conflict case `markSynced` then `remove` → on auth failure (401) `markFailed` (surface for manual retry) → on network failure leave `pending` with backoff (`attempts++`, exponential cap). Returns a summary `{ synced, failed, remaining }`. **Pure-ish:** all I/O injected, so node:test drives it with fakes.
- `lib/offline/backoff.ts` — **NEW** pure backoff calc.

Form wiring (`feed-form`, `cat-report-form`, `incident-form` — **EDIT**): submit handler becomes: if `navigator.onLine` → try direct POST; on network error or `!onLine` → `enqueue()` and optimistically navigate with a "saved, will sync" state. Register `window.addEventListener('online', flush)` and a `visibilitychange`/`focus` flush, and a flush on app load — centralized in a small `components/sync-provider.tsx` (**NEW**, client) mounted in `app/app/layout.tsx` so it only runs inside the authed app.

Tests (Phase 2) — **the heaviest test phase, all node:test, no new runner**:

- `lib/offline/outbox.test.ts` — enqueue/list/update/remove/transitions against the fake store; dedupe by `id`.
- `lib/offline/sync.test.ts` — flush happy path; replay/dup → synced; 401 → failed (not dropped); network error → stays pending + backoff bumps; multiple items ordering.
- `lib/offline/backoff.test.ts` — boundaries + cap.

**Reversibility:** revert the form-wiring + provider commit → forms fall back to Phase 1's direct POST. The `lib/offline/*` modules are inert if not called. No SW involved yet, so **no eviction needed to roll back** — this is why outbox lands before the SW.

**Deploy gate:** medium — changes submit UX. Recommend Deploy-gate approval; revert is a single commit, no cached SW to evict.

---

### Phase 3 — Serwist service worker + read caching (the only brick-risk phase)

**Goal:** installable offline shell + Background Sync on Android + read caching. **This is the phase the kill-switch exists for.** Behind `NEXT_PUBLIC_SW_ENABLED` and shipped via **canary**.

Dependencies:

- `npm i @serwist/next serwist` (one dep family, well-trodden Workbox successor — satisfies "prefer well-trodden libraries").

Files:

- `next.config.ts` — **EDIT**. Wrap with `withSerwist({ swSrc: 'app/sw.ts', swDest: 'public/sw.js', disable: process.env.NEXT_PUBLIC_SW_ENABLED !== 'true' })` _inside_ the existing `withNextIntl` composition. `disable` means **the build emits no SW unless the flag is on** — CI/preview stay SW-free by default.
- `app/sw.ts` — **NEW**. Serwist SW:
  - `precacheEntries` = app shell only.
  - **Network-first** for `/app/**` write/navigation routes; **never** cache-first RSC payloads (avoid stale-RSC trap — explicit `denylist`/route rules for `_next/data` and RSC requests).
  - Runtime **StaleWhileRevalidate** for _last-viewed_ colony/cat GET document requests only (narrow URL pattern), short max-entries + maxAge.
  - **Background Sync** (`@serwist/background-sync` queue) registered for the 3 POST endpoints on browsers that support it (Android/Chrome). The replay handler calls the **same** flush logic shape as `lib/offline/sync.ts` (import the pure flush; the SW provides a `fetcher`). On iOS (no Background Sync) this is simply absent → Phase-2 online/foreground flush covers it.
- `components/sw-register.tsx` — **EDIT**. The `enabled` branch now registers `/sw.js`; add an `updatefound`/`controllerchange` reload-prompt (so a new SW doesn't serve stale shell). Still fully gated by the Phase-0 flag logic.
- `app/sw.ts` types — add `@serwist/next` to `tsconfig` lib/types as their docs require.

Tests (Phase 3):

- The SW build is verified by `next build` with `NEXT_PUBLIC_SW_ENABLED=true` in CI (a build-only job; no runtime test runner for the SW). Keep all replay/flush _logic_ in `lib/offline/sync.ts` (already tested in Phase 2) — the SW is thin glue.
- `lib/offline/sw-flags.test.ts` (Phase 0) still guards the register/kill/cleanup decision.
- Manual matrix (**required before prod promote**): Android install → airplane mode → submit each of the 3 writes → re-connect → Background Sync drains; iOS install → airplane mode → submit → reopen app → foreground flush drains; **kill-switch drill** (see runbook) on a canary.

**Reversibility:** two layers.

1. **Instant, no redeploy:** set `NEXT_PUBLIC_SW_KILL=true` (or `NEXT_PUBLIC_SW_ENABLED=false`) → returning users get the cleanup/kill SW → unregister + caches cleared + reload. (Env change → redeploy of the tiny registration is fast; or pre-bake the kill behaviour so a flag flip alone suffices on next load.)
2. **Code revert:** revert the Phase-3 PR. Returning users still need eviction → that's what the kill-switch deploy is for (below).

**Deploy gate:** **MANDATORY human Deploy gate + canary.** This is the only phase that can brick returning installed users via a poisoned/sticky SW. Promote to prod only after the manual matrix + a kill-switch drill on the canary pass.

---

### Phase 4 — Sync UX

**Goal:** make sync state legible. Data comes from `lib/offline` (Phase 2); visuals can be refined by Compass.

Files:

- `components/sync-indicator.tsx` — **NEW** client. Persistent connection/sync chip in the app chrome (`app/app/layout.tsx`): online/offline + "N pending" / "syncing" / "N failed — retry".
- `components/sync-provider.tsx` — **EDIT**. Expose outbox counts via context (subscribe to store changes + `online`/`offline`).
- Per-update status: the optimistic post-submit screens show pending/synced/failed for the just-submitted item with a **Retry** button (calls `flush`).
- i18n — **EDIT** `messages/en.json` + `messages/pt.json`, add an `offline` namespace. Keys (EN + PT both required):
  - `offline.online`, `offline.offline`, `offline.pending` (`{count}`), `offline.syncing`, `offline.synced`, `offline.failed` (`{count}`), `offline.retry`, `offline.savedWillSync`, `offline.syncFailedAuth` (re-sign-in prompt), `offline.installPrompt` (optional).
  - `messages/messages.test.ts` already enforces EN/PT key parity — it will fail CI if PT is missing a key (good guardrail).

Tests (Phase 4):

- Count/derivation logic (e.g. `summarizeOutbox(items)` → `{ pending, syncing, failed }`) goes in `lib/offline/summary.ts` + `lib/offline/summary.test.ts` (node:test). The components are thin.
- `messages.test.ts` parity guards i18n.

**Reversibility:** revert the PR; purely additive UI. No data-path impact.

**Deploy gate:** light (UI only).

---

## 3. Rollback procedure (the critical deliverable)

### 3.1 The kill-switch SW (`public/sw-kill.js`)

```js
// public/sw-kill.js — evicts any previously-installed SW and all caches.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) await caches.delete(key);
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) client.navigate(client.url);
    })(),
  );
});
```

This is committed in **Phase 0**, before any caching SW exists. It is the single source of truth for "make a returning user clean again."

### 3.2 Flag behaviour (`NEXT_PUBLIC_SW_ENABLED`, `NEXT_PUBLIC_SW_KILL`)

`components/sw-register.tsx` decides via the pure `swMode({ enabled, kill })` helper:

| `NEXT_PUBLIC_SW_ENABLED` | `NEXT_PUBLIC_SW_KILL` | Action on next page load                                              |
| ------------------------ | --------------------- | --------------------------------------------------------------------- |
| `true`                   | unset/`false`         | Register real `/sw.js` (caching + Background Sync)                    |
| unset/`false`            | unset/`false`         | **Cleanup:** unregister any existing SW, leave none                   |
| any                      | `true`                | **Kill:** register `/sw-kill.js` → unregister + clear caches + reload |

Because `next.config.ts` sets Serwist `disable` from `NEXT_PUBLIC_SW_ENABLED`, the **build emits no `/sw.js`** when the flag is off — defence in depth.

### 3.3 Deploy runbook — "ship the kill-switch" (the panic button)

When a bad SW is suspected in prod (stale shell, users stuck, write path broken):

1. **Flip the flag (fastest):** in Vercel project env, set `NEXT_PUBLIC_SW_KILL=true` (and/or `NEXT_PUBLIC_SW_ENABLED=false`) for **Production**. Redeploy (Vercel "Redeploy" on the current prod deployment, or push an empty commit). Because the flag is `NEXT_PUBLIC_*` it is inlined at build → a redeploy is required; this is seconds-to-minutes.
2. **Returning users self-heal:** on their next app open, `sw-register` registers `/sw-kill.js` → it unregisters the old SW, deletes all caches, and force-reloads. They are now on a SW-less, network-only app (identical to today's behaviour).
3. **If a user is hard-stuck** (won't even fetch the new registration because the old SW serves a fully-cached shell): the network-first navigation rule in `app/sw.ts` means the HTML is re-fetched on load, so the new `sw-register` runs. As a last resort, instruct the user: remove the PWA from the home screen and re-add (or DevTools → Application → Unregister). Document this in the support note.
4. **Verify recovery:** on a test device that had the bad SW — open app, DevTools/Remote-inspect → Application → Service Workers shows **none** (or only `sw-kill`), Cache Storage empty, app loads fresh from network. Confirm the 3 writes work online.

### 3.4 Per-phase revert

| Phase | How to revert                                                                                                  | Eviction needed?          |
| ----- | -------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 0     | Revert PR. Kill-switch file removed (inert anyway).                                                            | No                        |
| 1     | Revert the 3 form edits → `action` points back at server actions. Routes stay (additive, harmless).            | No                        |
| 2     | Revert form-wiring + `sync-provider` commit → forms fall back to direct POST (Phase 1). `lib/offline/*` inert. | No                        |
| 3     | **Flip `NEXT_PUBLIC_SW_KILL=true` first (evict), then** revert the Phase-3 PR.                                 | **Yes — via kill-switch** |
| 4     | Revert PR (UI only).                                                                                           | No                        |

Only **Phase 3** ever requires eviction — which is the entire reason the kill-switch lands in Phase 0.

### 3.5 Verifying recovery (any rollback)

- DevTools → Application → Service Workers: none (or `sw-kill`).
- DevTools → Application → Cache Storage: empty.
- Network tab: app HTML + RSC fetched from network (200, not from SW).
- Submit one feeding, one cat report, one incident **online** → each returns `{ ok, id }` and the success screen renders. No duplicate rows on double-submit (UUID idempotency).

---

## 4. Dependencies, env, timing, risks

**New dependency:** `@serwist/next` + `serwist` (Phase 3 only). No new test runner — all logic stays in `lib/` under `node --test`.

**Env (Vercel + `.env.example`):**

- `NEXT_PUBLIC_SW_ENABLED` — gate for the real SW. Default unset/`false` in dev, preview, and prod **until Phase 3 is approved**.
- `NEXT_PUBLIC_SW_KILL` — panic button. Default unset/`false`.

**Asset action item:** replace `public/icon-192.png` / `public/icon-512.png` (current files look like placeholders) with proper SCoT-logo maskable icons; add a maskable-safe 512 variant. Owned by design (Compass), needed before prod PWA promote.

**CI implications:**

- Phases 0–2, 4: no build changes beyond new files; existing `lint`/`typecheck`/`test`/`build` cover them.
- Phase 3: add a CI step that runs `next build` with `NEXT_PUBLIC_SW_ENABLED=true` to verify the SW compiles (build-only; no runtime SW test). Default CI build stays flag-off.

**Risks & mitigations:**

- **Poisoned/sticky SW bricks returning users** → kill-switch-first (Phase 0), network-first navigation, mandatory canary + kill drill before Phase 3 prod promote.
- **iOS has no Background Sync** → covered by Phase-2 online/foreground flush; do not rely on Background Sync for iOS in any copy or test.
- **Auth expiry mid-flush** → `refreshSession()` before POST; 401 → mark `failed`, surface for manual retry; never drop the item.
- **Duplicate writes on replay** → client UUID into PK + `upsert ignoreDuplicates`; verified all 3 tables have `gen_random_uuid()` PKs, so **no migration**.
- **Stale RSC served from cache** → explicit denylist of `_next/data`/RSC + network-first for `/app/**`.
- **Service-role key leaking client-side** → alert hooks stay in route handlers only; `createServiceClient()` already throws if run in the browser.

**No database migration is required for any phase** (confirmed against `supabase/migrations/0002_domain.sql` + `0003_rls.sql`).

---

## 5. Recommended PR sequence

1. PR-0 (kill-switch + flags + manifest/icon verify) — commit, light gate.
2. PR-1 (3 route handlers + form fetch) — Deploy gate, smoke test online.
3. PR-2 (outbox + sync + provider) — Deploy gate.
4. **PR-3 (Serwist SW + read cache + Background Sync) — MANDATORY Deploy gate + canary + kill drill.**
5. PR-4 (sync UX + i18n) — light gate.

Each PR is CI-green and individually revertible per §3.4.
