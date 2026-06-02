-- 0001_init — foundational multi-tenant baseline.
--
-- Scope: the organisation/role/RLS *spine* only. The full domain schema
-- (colonies, cats, feeding_events, cat_sightings, incidents, audit_log, ...)
-- is delivered by the "Database schema & migrations" task; the full role
-- matrix by the "Row-Level Security & multi-tenant policies" task.
--
-- Decisions baked in here (from the data review):
--   * Roles live on a memberships(user, org, role) join table, NOT on users,
--     so a user can belong to multiple orgs with a different role in each.
--   * Soft-delete via deleted_at; RLS reads exclude soft-deleted rows.
--   * RLS is ON for every table — absence of a policy means deny.

create type public.app_role as enum ('admin', 'caretaker', 'feeder');

create table public.organisations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  logo_url    text,
  notes       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table public.memberships (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  role             public.app_role not null,
  created_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  unique (user_id, organisation_id)
);

create index memberships_org_idx on public.memberships (organisation_id);
create index memberships_user_idx on public.memberships (user_id);

-- Org IDs the current user actively belongs to. SECURITY DEFINER so it can be
-- referenced inside RLS policies without recursing into memberships' own RLS.
create or replace function public.current_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select organisation_id
  from public.memberships
  where user_id = auth.uid()
    and deleted_at is null
$$;

-- Does the current user hold one of `roles` in org `org`?
create or replace function public.has_org_role(org uuid, roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships
    where user_id = auth.uid()
      and organisation_id = org
      and role = any (roles)
      and deleted_at is null
  )
$$;

alter table public.organisations enable row level security;
alter table public.memberships enable row level security;

-- Minimal read policies scoped by membership. Writes are intentionally NOT
-- granted here — the Auth/RLS tasks define the full role matrix. RLS is ON,
-- so the absence of a write policy = deny by default.
create policy "members read their organisation"
  on public.organisations for select
  using (id in (select public.current_org_ids()) and deleted_at is null);

create policy "users read their own memberships"
  on public.memberships for select
  using (user_id = auth.uid() and deleted_at is null);
