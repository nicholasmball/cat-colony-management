# SCoT Colony Management App

Volunteer-developed MVP for **Street Cats of Tavira** — a mobile-first web app to manage feral cat colonies, feeding schedules, and incident reporting. Designed for use by volunteer feeders in the field.

## Project status

Pre-development. The MVP requirements document (`SCOT MVP Requirements v1.docx`) has been received and analysed. A list of clarifying questions for SCoT (`SCoT MVP - Clarifying Questions.md`) has been prepared, with 8 priority questions flagged as blockers before development begins.

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

See `SCoT MVP - Clarifying Questions.md`. Eight priority items must be answered before architecture is finalised: sign-up flow, offline support, multi-org timeline, incident urgency levels, notification channels, language(s), Wix data flow, and GDPR handling of departing volunteers.

## Files

- `SCOT MVP Requirements v1.docx` — original requirements from SCoT
- `SCoT MVP - Clarifying Questions.md` — open questions to send back to SCoT
