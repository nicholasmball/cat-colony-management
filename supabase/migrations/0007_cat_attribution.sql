-- 0007_cat_attribution — record who reported and who confirmed a cat.
--
-- Builds on 0002_domain (cats) + 0004_auth (auth.users). Mirrors the
-- incident_comments.author_id pattern (0006:18): attribution is a plain FK to
-- auth.users with `on delete set null`, so a departing volunteer's account can
-- be removed without orphaning or blocking the cat row — the cat survives, the
-- attribution simply degrades to NULL. (Aligns with the GDPR "departure =
-- deactivate, nothing personal to erase" decision in CLAUDE.md.)
--
-- reported_by / confirmed_by are set by the server actions from the auth
-- session (auth.uid()), never from form input — same trust boundary as
-- incidents.reported_by and incident_comments.author_id. confirmed_at records
-- when the manager promoted the cat new_unconfirmed → active.
--
-- All three columns are nullable: existing rows get NULL and degrade gracefully
-- (the cat page shows a time-only "Reported {when}" line, no name). No RLS
-- change is needed — the existing "members read cats" SELECT policy
-- (0003_rls) already covers these new columns.

alter table public.cats
  add column reported_by  uuid references auth.users (id) on delete set null,
  add column confirmed_by uuid references auth.users (id) on delete set null,
  add column confirmed_at timestamptz;
