# SCoT Colony Management App

Volunteer-developed MVP for **Street Cats of Tavira** — a mobile-first web app to manage feral cat colonies, feeding schedules, and incident reporting. Designed for use by volunteer feeders in the field.

## Project status

Pre-development. The MVP requirements document (`SCOT MVP Requirements v1.docx`) has been received and analysed. The 8 priority clarifying questions have been answered by SCoT (see `SCoT MVP - Clarifying Questions.md`); architecture can now be finalised. Two items remain outstanding before/while building: a re-phrased version of the incident-urgency question (SCoT didn't understand the original), and two questions SCoT raised back (native apps? costs?).

### Decisions from SCoT (priority answers)

- **Sign-up:** Invite-only — no open self-registration.
- **Offline:** Required. The app must work without signal in the field and sync later → **offline-first / PWA** with a local queue.
- **Multi-org:** A real goal within 12 months → enforce strict per-`organisation_id` separation from day one (already the plan).
- **Notifications:** Push + SMS for urgent items (not email-only). SMS needs a paid provider (e.g. Twilio); web push on iOS requires an installed PWA.
- **Language:** Portuguese **and** English from day one → i18n in place from the start.
- **Wix:** Fully independent — no data flows between the public Wix site and the app.
- **GDPR / volunteers:** Minimal personal data by design — store only a username/ID, "not tracking the volunteers, just the cats." Departure = deactivate; nothing personal to erase.
- **Stack:** SCoT's call left to us → Next.js + Supabase on Vercel confirmed.

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
- The app should answer four daily questions: *Was the colony fed? Which cats were seen? Are there new or missing cats? Is there a problem?*
- Missing-cat status requires human review — never auto-mark after a single absence.

## Open questions

The 8 priority items are answered (see Decisions above). Still outstanding in `SCoT MVP - Clarifying Questions.md`:

- **Incident urgency levels** — SCoT didn't understand the original question; re-phrased there as Urgent vs. Not-urgent (with examples) and awaiting a reply.
- **Native apps?** — confirm a PWA (installable on Android + iPhone, no App/Play Store build) is acceptable for the MVP.
- **Costs** — provide a rough monthly estimate (Supabase, Vercel, domain, and per-message SMS as the main variable cost).

Plus the non-priority questions (accounts/roles, photo limits, alert thresholds, audit/export, etc.) to be answered alongside the build.

## Files

- `SCOT MVP Requirements v1.docx` — original requirements from SCoT
- `SCoT MVP - Clarifying Questions.md` — open questions to send back to SCoT
