# SCoT Colony Management App

Volunteer-developed MVP for **Street Cats of Tavira** — a mobile-first web app to manage feral cat colonies, feeding schedules, and incident reporting. Designed for use by volunteer feeders in the field.

## Project status

**Built and live in pre-launch testing.** The MVP is implemented and deployed to production (Vercel + Supabase), with an e2e suite that runs against prod. It currently runs **entirely on the developer's (Nick's) personal cloud accounts** (Vercel, Supabase, Cloudflare R2) — moving it onto **SCoT's own accounts** is the main pre-handover task (see the migration-guide task in the backlog). The backlog (epics, phased order, per-task workflows) is managed in VibeCodes.

Original requirements: `SCOT MVP Requirements v1.docx`; clarifying answers from SCoT: `SCoT MVP - Clarifying Questions.md`.

### What's built (vs the MVP spec §16)

All MVP-spec items are implemented and deployed: invite-only auth + roles, organisations, colonies, cat records (+ status & status-history), feeding schedules, the 30-second feeding update (seen/not-seen, problem/danger/new-cat), new-cat reporting, missing-cat concern review, incident reporting + triage/resolve, the alert engine (event **and** time-based sweeps), the in-app notification centre, the caretaker dashboard + Today, alert thresholds, members/invites, EN+PT i18n, offline-first PWA, PWA icons, and moving a cat between colonies.

The **one remaining MVP-spec item is email notifications** (§14 lists in-app + email; in-app is done). **Push + SMS are NOT in the original spec** — they came from SCoT's clarifying round and are post-MVP enhancements (backlog), gated on SCoT supplying a paid provider + phone-number/privacy decisions (see `docs/scot-notification-channels.html`).

### Decisions from SCoT (priority answers)

- **Sign-up:** Invite-only — no open self-registration.
- **Offline:** Required. The app must work without signal in the field and sync later → **offline-first / PWA** with a local queue.
- **Multi-org:** A real goal within 12 months → enforce strict per-`organisation_id` separation from day one (already the plan).
- **Notifications:** Push + SMS for urgent items (not email-only). SMS needs a paid provider (e.g. Twilio); web push on iOS requires an installed PWA.
- **Language:** Portuguese **and** English from day one → i18n in place from the start.
- **Wix:** Fully independent — no data flows between the public Wix site and the app.
- **GDPR / volunteers:** Minimal personal data by design — store only a username/ID, "not tracking the volunteers, just the cats." Departure = deactivate; nothing personal to erase. (Note: SMS would require storing caretaker phone numbers — an open decision.)
- **Stack:** SCoT's call left to us → Next.js + Supabase on Vercel confirmed.

### Operational decisions (round 2)

- **Incident urgency:** Two tiers — Urgent (poisoning, injured cat, threat from person, dog danger) → immediate push/SMS; Not urgent → dashboard only. Modelled as a configurable per-org lookup so tiers can expand later without a rewrite.
- **Alert thresholds (defaults, editable per org):** cat not-seen = 7 days · repeated not-seen = 3 consecutive · feeding missed = 12h after the scheduled window.
- **Incident close:** Caretaker/Admin only; reporting Feeder can comment but not resolve.
- **Platform:** PWA confirmed — installable on Android + iPhone, no native App/Play Store build for the MVP.

## Stack (in use)

- **Frontend:** Next.js (App Router, mobile-first) on **Vercel**.
- **Backend / DB:** **Supabase** (Auth, Postgres + Row-Level Security). Project ref `ogdeoskhplqnguyacxyh`. Migrations in `supabase/migrations/NNNN_*.sql`, applied via the Supabase MCP (then version normalised to `NNNN`).
- **Photos:** **Cloudflare R2** (private bucket `scot-photos`), served via short-lived presigned URLs (`lib/storage/r2.ts`, `aws4fetch`); object keys are org-scoped (`org/{orgId}/…`).
- **Scheduled alerts:** **pg_cron + pg_net** in Supabase POST `/api/cron/alerts` every 15 min with a Vault-stored bearer matching `CRON_SECRET` — runs the time-based sweeps (missed-feed, not-seen). Event alerts fire inline on the user action.
- **Offline:** Serwist service worker, gated behind `NEXT_PUBLIC_SW_ENABLED` (currently **ON** in prod), with a `NEXT_PUBLIC_SW_KILL` kill-switch. Offline writes queue in an IndexedDB outbox; colony/cat/feed/Today pages are stale-while-revalidate cached.
- **i18n:** next-intl, EN + **European** Portuguese, cookie locale (key-parity guard in `messages/messages.test.ts`).
- **Hosting boundary:** Wix stays the public marketing site at the apex domain; the app lives at a subdomain (e.g. `app.streetcatsoftavira.org`). Independent unless SCoT requests data sharing — Wix cannot host Next.js / Supabase.

## Infrastructure & deployment notes

- **Live SCoT org** (prod DB): `46c8fdda-1a5e-481f-bc9e-4f98069afd91`. Real data imported from the Wix site (152 cats + 22 colonies + photos) via `scripts/import-from-site.mjs` (Playwright-driven, idempotent). Imported cats sit in an **"Imported from website"** holding colony for caretaker reassignment.
- **Env/secrets** live in Vercel: Supabase URL/anon, `SUPABASE_SERVICE_ROLE_KEY`, `R2_*` (bucket `scot-photos`), `CRON_SECRET`, the SW flags. R2 vars are marked **Sensitive** (can't be pulled back).
- **Tests:** unit/logic via `node --test` (`lib/**`, `messages/**`); **e2e** (`e2e/`, Playwright) runs against **prod** with a throwaway test org + verified teardown (creds in gitignored `.env.e2e`). e2e is **not** in CI. CI = lint / format / typecheck / build on Node 24.
- **Test → live handover:** the whole stack runs on Nick's personal accounts; migrating to SCoT's own Vercel / Supabase / Cloudflare / domain (and any email/SMS provider) is the key pre-handover step — to be documented in a plain-English guide (backlog task).

## Core domain model

- **Organisation** → owns **Colonies** → contain **Cats**
- **Feeding Schedules** assign **Feeders** to colonies; **Feeding Updates** record what happened
- **Incidents** attach to a colony and optionally a specific cat
- Roles: **Org Admin** (everything) → **Caretaker** (manages colony, reviews reports) → **Feeder** (field updates only)

Multi-org is in the data model but not the launch scope — scope every query by `organisation_id` from day one to avoid retrofitting later.

## Design principles from the spec

- The "30-second feeding update" is the UX north star.
- Cat records must accept incomplete data — never block creation because a field is missing.
- The app should answer four daily questions: _Was the colony fed? Which cats were seen? Are there new or missing cats? Is there a problem?_
- Missing-cat status requires human review — never auto-mark after a single absence.

## Open questions / outstanding

- **Notification channels:** email (MVP) + push + SMS (post-MVP) await SCoT supplying provider accounts + Catherine's answers (`docs/scot-notification-channels.html`, which also carries the rough monthly cost estimate — the previously-outstanding costs item).
- **Test → live handover:** migrate from Nick's personal cloud accounts to SCoT's own (the guide task).
- Lower-priority items to confirm: who promotes roles (Q9), caretaker colony visibility (Q10), one-role-per-org vs multiple (Q11 — defaulting to role-per-membership), photo volume/retention (Q12–14), cat-moves-colony **history** (Q22 — the move itself is built; history deferred), and post-login landing path (Q23).

## Files

- `SCOT MVP Requirements v1.docx` — original requirements from SCoT.
- `SCoT MVP - Clarifying Questions.md` — clarifying questions/answers.
- `docs/scot-notification-channels.html` — plain-English options + cost note on email/push/SMS for Catherine.
- `scripts/import-from-site.mjs` — idempotent importer of cats/colonies/photos from the Wix site (local tooling, untracked).
