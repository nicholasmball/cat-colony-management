-- 0006_incident_comments — append-only note thread on an incident.
--
-- Builds on 0002_domain (incidents) + 0001_init (current_org_ids()). The
-- "Feeder add a note without closing it" follow-up flagged at 0003_rls:118-120
-- lands here. Any active member of the org may read and add a note (a feeder's
-- only write on an incident); managers triage/resolve via the existing
-- "managers update incidents" UPDATE policy (0003_rls:88-90) — no triage
-- migration is needed.
--
-- Append-only: SELECT + INSERT policies only. No UPDATE/DELETE policy means a
-- note can never be edited or removed (deny-by-default), so the thread is an
-- honest history — mirrors feeding_events / cat_sightings (0003_rls:68-74).

create table public.incident_comments (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  incident_id     uuid not null references public.incidents (id) on delete cascade,
  author_id       uuid references auth.users (id) on delete set null,
  body            text not null,
  created_at      timestamptz not null default now()
);
create index incident_comments_incident_idx
  on public.incident_comments (incident_id, created_at);

alter table public.incident_comments enable row level security;

-- Read scoped to the caller's organisations (same shape as "members read
-- incidents", 0003_rls / 0002_domain:305-306).
create policy "members read incident_comments" on public.incident_comments for select
  using (organisation_id in (select public.current_org_ids()));

-- Any member of the org may add a note — org-membership only, no role gate and
-- no auth.uid() write-check (mirrors "members insert feeding_events",
-- 0003_rls:68-70). author_id is set by the action from the auth session.
create policy "members insert incident_comments" on public.incident_comments for insert
  with check (organisation_id in (select public.current_org_ids()));

-- append-only: no update/delete policy (deny-by-default).
