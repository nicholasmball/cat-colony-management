-- 0004_auth — onboarding bootstrap + invitations.
--
-- Invite-only (signups disabled in config). Two SECURITY DEFINER RPCs solve the
-- chicken-and-egg of RLS (you need a membership to do anything, but creating the
-- first org/membership is itself gated):
--   * create_organisation()  — an authenticated user spins up a new org and
--     becomes its admin (org + admin membership + seeded defaults).
--   * accept_invitation()     — an authenticated user redeems an invite token to
--     join an existing org with the invited role (email must match).

-- ── create_organisation ──────────────────────────────────────────────────────
create or replace function public.create_organisation(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_org uuid;
begin
  if auth.uid() is null then
    raise exception 'must be authenticated';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'organisation name is required';
  end if;

  insert into public.organisations (name) values (btrim(p_name)) returning id into new_org;
  insert into public.memberships (user_id, organisation_id, role)
    values (auth.uid(), new_org, 'admin');
  perform public.seed_org_defaults(new_org);
  return new_org;
end $$;

-- ── invitations ──────────────────────────────────────────────────────────────
create table public.invitations (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  email           text not null,
  role            public.app_role not null,
  token           uuid not null default gen_random_uuid(),
  invited_by      uuid references auth.users (id) on delete set null,
  accepted_at     timestamptz,
  created_at      timestamptz not null default now()
);
-- one active invite per email per org (expression uniqueness needs an index)
create unique index invitations_org_email_key on public.invitations (organisation_id, lower(email));
create index invitations_token_idx on public.invitations (token);
create index invitations_org_idx on public.invitations (organisation_id);

alter table public.invitations enable row level security;

-- Only Admins of the org manage its invitations. (Token redemption goes through
-- the SECURITY DEFINER accept_invitation() RPC, so invitees need no table grant.)
create policy "admin reads invitations" on public.invitations for select
  using (public.has_org_role(organisation_id, '{admin}'::public.app_role[]));
create policy "admin inserts invitations" on public.invitations for insert
  with check (
    public.has_org_role(organisation_id, '{admin}'::public.app_role[])
    and invited_by = auth.uid()
  );
create policy "admin deletes invitations" on public.invitations for delete
  using (public.has_org_role(organisation_id, '{admin}'::public.app_role[]));

-- ── accept_invitation ────────────────────────────────────────────────────────
create or replace function public.accept_invitation(p_token uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv public.invitations; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'must be authenticated'; end if;

  select * into inv from public.invitations
    where token = p_token and accepted_at is null;
  if inv.id is null then raise exception 'invalid or already-used invitation'; end if;

  -- The redeeming account's email must match the invite.
  if lower(inv.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'invitation email does not match this account';
  end if;

  insert into public.memberships (user_id, organisation_id, role)
    values (uid, inv.organisation_id, inv.role)
    on conflict (user_id, organisation_id) do update set role = excluded.role, deleted_at = null;

  update public.invitations set accepted_at = now() where id = inv.id;
  return inv.organisation_id;
end $$;
