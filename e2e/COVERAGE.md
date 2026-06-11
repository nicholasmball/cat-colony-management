# E2E coverage map

A map of the app's user-facing flows to the Playwright spec(s) that exercise
them. The suite runs against **production** with a throwaway per-run org +
verified teardown (see `README.md`). It is **not** in per-PR CI.

Legend: **covered** = the flow's happy path + key guards are asserted ·
**partial** = the flow is touched but a notable branch is unverified ·
**GAP** = no spec (now filled where genuinely testable).

## Coverage table

| Flow                                                       | Spec(s)                                  | Status    |
| ---------------------------------------------------------- | ---------------------------------------- | --------- |
| Login (session loads / redirect to login)                  | `auth.spec.ts`                           | covered   |
| **Forgot-password (request reset link)**                   | `forgot-password.spec.ts` _(added)_      | covered   |
| Role access guards (feeder/caretaker/admin)                | `access.spec.ts`                         | covered   |
| Colonies — create                                          | `colonies.spec.ts`, `ui.ts` helper       | covered   |
| Colonies — archive (soft-delete)                           | `colony-archive.spec.ts`                 | covered   |
| Colony — feeding-history / last-fed / incidents            | `colony-history.spec.ts`                 | covered   |
| Cats — report → confirm (→ active)                         | `cats.spec.ts`                           | covered   |
| Cats — report → reject (duplicate)                         | `cats.spec.ts`                           | covered   |
| Cats — edit details                                        | `cats.spec.ts`                           | covered   |
| Cats — move between colonies                               | `cat-move.spec.ts`                       | covered   |
| Cats — status history + sighting timeline                  | `cat-history.spec.ts`                    | covered   |
| Cat photos on the feed page (avatar/fallback)              | `feeding.spec.ts`                        | covered\* |
| Feeding update (fed / tri-toggle)                          | `feeding.spec.ts`                        | covered   |
| Feeding schedules (recurring + one-off + del)              | `schedules.spec.ts`                      | covered   |
| Today (assigned colony surfaces)                           | `schedules.spec.ts`, `dashboard.spec.ts` | covered   |
| Incidents — report → triage → resolve                      | `incidents.spec.ts`                      | covered   |
| **Incidents — comment thread + feeder-can't-resolve rail** | `incident-comments.spec.ts` _(added)_    | covered   |
| Dashboard (four daily surfaces)                            | `dashboard.spec.ts`                      | covered   |
| Alert thresholds (save / validate / i18n)                  | `alerts.spec.ts`                         | covered   |
| Members — invite                                           | `members.spec.ts`                        | covered   |
| Members — re-invite (re-issue + guards)                    | `members.spec.ts`                        | covered   |
| Members — change role + deactivate                         | `members.spec.ts`                        | covered   |
| Members — permanently erase (+ rails)                      | `member-erase.spec.ts`                   | covered   |
| Notifications (urgent fan-out, mark-read)                  | `notifications.spec.ts`                  | covered   |
| i18n PT/EN (nav + page labels, no raw keys)                | `i18n.spec.ts`, `help.spec.ts`           | covered   |
| Help / quick-start (EN + PT, all roles)                    | `help.spec.ts`                           | covered   |
| **Org settings — edit name/notes/timezone**                | `org-settings.spec.ts` _(added)_         | covered   |

\* Photo _avatar/fallback presentation_ on the feed row is asserted. The actual
R2 photo **upload** is not e2e-tested (see below).

## Gaps filled (this branch)

Three flows had no/weak coverage and are now specced:

- **`forgot-password.spec.ts`** — the only auth flow the suite missed. Asserts
  the "Forgot password?" link from `/login`, the existence-safe `?sent=1`
  confirmation for any email (including an impossible `.invalid` address, so it
  never leaks which addresses are registered), and PT localisation with no raw
  i18n keys. Runs unauthenticated; touches no org data.
- **`org-settings.spec.ts`** — the admin-only org edit form (untested beyond the
  access guard). Asserts name/notes/timezone persist on reload **and** in the
  DB (scoped to the test org, then restores the name), blank-name and invalid-
  timezone server-side rejections with localized errors, and a caretaker being
  bounced.
- **`incident-comments.spec.ts`** — the documented SCoT rule "reporting Feeder
  can comment but **not** resolve." A feeder reports + comments (row persists +
  renders) while seeing **no** manager action panel (no Manage/Start/Resolve);
  the incident stays open; an admin then sees the note **and** the controls the
  feeder was denied.

## Not e2e-testable headlessly (by design — not faked)

- **Offline sync / IndexedDB outbox** — requires real network-loss simulation +
  service-worker queue replay across reconnects; not reliably driveable in a
  headless prod run.
- **Photo upload to Cloudflare R2** — needs a presigned PUT to live R2 + binary
  upload; the suite verifies the avatar/fallback _presentation_ instead.
- **Real email delivery** (invite, password-reset, digest) — sent by Supabase
  Auth SMTP / Resend; delivery happens out-of-band. We assert the app-side
  trigger (invitation row, `?sent=1` confirmation), not the inbox.
- **Push / SMS notifications** — post-MVP, gated on a paid provider; not built.
- **pg_cron time-based alert sweeps** — fire server-side every 15 min via
  pg_cron+pg_net; event alerts (the inline path) are covered via
  `notifications.spec.ts`.
