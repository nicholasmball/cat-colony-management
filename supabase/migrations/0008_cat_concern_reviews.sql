-- 0008_cat_concern_reviews — caretaker review log for "cats of concern".
--
-- Builds on 0002_domain (cats, cat_sightings, alert_settings) + 0001_init
-- (current_org_ids(), has_org_role()) + 0003_rls (the cats/incidents write
-- matrix this mirrors). Step 4 of the missing-cat process: the alert engine and
-- colony page flag a cat as a *review candidate* when a sighting signal trips an
-- org threshold (not-seen ≥ N days, repeated not-seen, or a "concern" sighting).
-- A caretaker then records what they decided about that signal here.
--
-- This table records ONLY the two soft review outcomes:
--   * ignored    — "I've looked, no action needed" (clears until a fresh signal)
--   * monitoring  — "keep watching" (stays visible in the Monitoring group)
-- Re-raise is time-anchored: a review only silences signals OLDER than it. A new
-- non-seen/concern sighting dated after the latest review re-raises the cat.
--
-- Mark-missing / Mark-found are NOT outcomes here — they are cats.status changes
-- (active ⇆ missing) already audited by the log_cat_status_change trigger
-- (0002_domain:101). Keeping them out avoids two competing sources of truth.
--
-- reviewed_by is a plain FK to auth.users with `on delete set null`, mirroring
-- cats.confirmed_by (0007) / incident_comments.author_id (0006): a departing
-- volunteer's account can be removed without orphaning the review row (aligns
-- with the GDPR "departure = deactivate" decision in CLAUDE.md). It is set by
-- the server action from the auth session, never from form input.

create type public.concern_review_outcome as enum ('ignored', 'monitoring');

create table public.cat_concern_reviews (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  cat_id          uuid not null references public.cats (id) on delete cascade,
  outcome         public.concern_review_outcome not null,
  note            text,
  reviewed_by     uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index cat_concern_reviews_cat_idx on public.cat_concern_reviews (cat_id, created_at desc);
create index cat_concern_reviews_org_idx on public.cat_concern_reviews (organisation_id);

alter table public.cat_concern_reviews enable row level security;
-- members read in-org; only admin/caretaker insert (mirror the cats/incidents
-- write policies in 0003_rls). Append-only: no UPDATE/DELETE policy means a
-- review can never be edited or removed (deny-by-default), so the log is an
-- honest history — matches feeding_events / cat_sightings (0003_rls:68-74).
create policy "members read cat_concern_reviews" on public.cat_concern_reviews for select
  using (organisation_id in (select public.current_org_ids()));
create policy "managers insert cat_concern_reviews" on public.cat_concern_reviews for insert
  with check ( organisation_id in (select public.current_org_ids())
               and public.has_org_role(organisation_id, '{admin,caretaker}'::public.app_role[]) );
