# SCoT Colony Management App

Volunteer-developed MVP for **Street Cats of Tavira** — a mobile-first web app to manage feral cat colonies, feeding schedules, and incident reporting. Designed for use by volunteer feeders in the field.

## Project status

Pre-development, moving into build. The MVP requirements (`SCOT MVP Requirements v1.docx`) have been analysed and all blocking clarifying questions answered by SCoT (see `SCoT MVP - Clarifying Questions.md`) — including a second round covering incident urgency (Q4), alert thresholds (Q15–17), incident-close permissions (Q18) and confirmation of the PWA approach. The only outstanding item is a rough running-cost estimate. The backlog (epics, phased order, per-task workflows) is managed in VibeCodes.

### Decisions from SCoT (priority answers)

- **Sign-up:** Invite-only — no open self-registration.
- **Offline:** Required. The app must work without signal in the field and sync later → **offline-first / PWA** with a local queue.
- **Multi-org:** A real goal within 12 months → enforce strict per-`organisation_id` separation from day one (already the plan).
- **Notifications:** Push + SMS for urgent items (not email-only). SMS needs a paid provider (e.g. Twilio); web push on iOS requires an installed PWA.
- **Language:** Portuguese **and** English from day one → i18n in place from the start.
- **Wix:** Fully independent — no data flows between the public Wix site and the app.
- **GDPR / volunteers:** Minimal personal data by design — store only a username/ID, "not tracking the volunteers, just the cats." Departure = deactivate; nothing personal to erase.
- **Stack:** SCoT's call left to us → Next.js + Supabase on Vercel confirmed.

### Operational decisions (round 2)

- **Incident urgency:** Two tiers — Urgent (poisoning, injured cat, threat from person, dog danger) → immediate push/SMS; Not urgent → dashboard only. Modelled as a configurable per-org lookup so tiers can expand later without a rewrite.
- **Alert thresholds (defaults, editable per org):** cat not-seen = 7 days · repeated not-seen = 3 consecutive · feeding missed = 12h after the scheduled window.
- **Incident close:** Caretaker/Admin only; reporting Feeder can comment but not resolve.
- **Platform:** PWA confirmed — installable on Android + iPhone, no native App/Play Store build for the MVP.

## Recommended stack

- **Frontend:** Next.js (mobile-first, deployed on Vercel)
- **Backend / DB:** Supabase (Auth, Postgres with Row-Level Security, Storage for photos)
- **Hosting boundary:** Wix stays as the public marketing site at the apex domain; the operational app lives at a subdomain (e.g., `app.streetcatsoftavira.org`). The two are independent unless SCoT requests data sharing.

Wix cannot host Next.js or run Supabase server-side — keep them as separate sites linked by a button.

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

## Open questions

All blocking questions are answered (see Decisions above). Remaining:

- **Costs** — still to provide: a rough monthly estimate (Supabase, Vercel, domain, and per-message SMS as the main variable cost).

Lower-priority items to confirm alongside the build: who promotes roles (Q9), caretaker colony visibility (Q10), one-role-per-org vs. multiple (Q11 — defaulting to role-per-membership), photo volume/retention (Q12–14), cat-moves-colony history (Q22), and post-login landing path (Q23).

## Files

- `SCOT MVP Requirements v1.docx` — original requirements from SCoT
- `SCoT MVP - Clarifying Questions.md` — open questions to send back to SCoT
