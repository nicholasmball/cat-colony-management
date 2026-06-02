-- 0002_domain — full MVP domain schema.
--
-- Builds on 0001_init (organisations, memberships, current_org_ids(),
-- has_org_role()). Approved data model: colonies → cats (+ status history),
-- feeding schedules/events, cat sightings, incidents (+ per-org urgency lookup),
-- attachments, alert settings, notifications, audit log.
--
-- RLS is ENABLED on every table with membership-scoped SELECT policies.
-- The full write/role matrix is delivered by the "Row-Level Security" task —
-- absence of an INSERT/UPDATE/DELETE policy here = deny by default.

-- ── Enums ────────────────────────────────────────────────────────────────────
create type public.cat_status as enum
  ('active', 'missing', 'deceased', 'adopted', 'relocated', 'new_unconfirmed');
create type public.sighting_status as enum ('seen', 'not_seen', 'concern');
create type public.incident_type as enum
  ('sick_injured', 'new_cat', 'missing_concern', 'dead_cat', 'poisoning',
   'threat_person', 'dog_danger', 'access_problem', 'other');
create type public.incident_status as enum
  ('open', 'in_progress', 'resolved', 'closed');
create type public.notif_channel as enum ('in_app', 'email', 'push', 'sms');
create type public.attachment_entity as enum ('cat', 'incident', 'colony');

-- ── Shared trigger: keep updated_at fresh ────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ── colonies ─────────────────────────────────────────────────────────────────
create table public.colonies (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete cascade,
  name                 text not null,
  feeding_window_start time,
  feeding_window_end   time,
  timezone             text not null default 'Europe/Lisbon',
  caretaker_id         uuid references auth.users (id) on delete set null,
  lat                  double precision,
  lng                  double precision,
  photo_url            text,
  notes                text,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);
create index colonies_org_idx on public.colonies (organisation_id);
create index colonies_caretaker_idx on public.colonies (caretaker_id);
create trigger colonies_set_updated before update on public.colonies
  for each row execute function public.set_updated_at();

-- ── cats ─────────────────────────────────────────────────────────────────────
create table public.cats (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  colony_id       uuid not null references public.colonies (id) on delete cascade,
  name            text,
  temp_id         text,
  status          public.cat_status not null default 'new_unconfirmed',
  photo_url       text,
  description     text,
  colour          text,
  markings        text,
  sex             text,
  neutered        boolean,
  microchip       text,
  fiv_felv        text,
  approx_age      text,
  characteristics text,
  adoptable       boolean,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  -- AC: never block creation, but require at least one identifier
  constraint cats_need_identifier check (name is not null or temp_id is not null)
);
create index cats_colony_idx on public.cats (colony_id) where deleted_at is null;
create index cats_org_idx on public.cats (organisation_id);
create index cats_status_idx on public.cats (organisation_id, status) where deleted_at is null;
create trigger cats_set_updated before update on public.cats
  for each row execute function public.set_updated_at();

-- ── cat_status_history (append-only) ─────────────────────────────────────────
create table public.cat_status_history (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  cat_id          uuid not null references public.cats (id) on delete cascade,
  old_status      public.cat_status,
  new_status      public.cat_status not null,
  changed_by      uuid references auth.users (id) on delete set null,
  reason          text,
  created_at      timestamptz not null default now()
);
create index cat_status_history_cat_idx on public.cat_status_history (cat_id, created_at desc);

-- record every status change automatically
create or replace function public.log_cat_status_change()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    insert into public.cat_status_history
      (organisation_id, cat_id, old_status, new_status, changed_by)
    values (new.organisation_id, new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end $$;
create trigger cats_status_history after update on public.cats
  for each row execute function public.log_cat_status_change();

-- ── feeding_schedules ────────────────────────────────────────────────────────
create table public.feeding_schedules (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  colony_id       uuid not null references public.colonies (id) on delete cascade,
  feeder_id       uuid references auth.users (id) on delete set null,
  weekday         smallint check (weekday between 0 and 6),  -- recurring
  specific_date   date,                                       -- one-off
  approx_time     time,
  notes           text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  constraint feeding_schedules_when check (weekday is not null or specific_date is not null)
);
create index feeding_schedules_colony_idx on public.feeding_schedules (colony_id) where deleted_at is null;
create index feeding_schedules_feeder_idx on public.feeding_schedules (feeder_id);
create trigger feeding_schedules_set_updated before update on public.feeding_schedules
  for each row execute function public.set_updated_at();

-- ── feeding_events (append-only; client-generatable id for offline idempotency)
create table public.feeding_events (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  colony_id       uuid not null references public.colonies (id) on delete cascade,
  feeder_id       uuid references auth.users (id) on delete set null,
  observed_at     timestamptz not null default now(),
  fed             boolean not null default false,
  problem         boolean not null default false,
  food_issue      boolean not null default false,
  danger          boolean not null default false,
  notes           text,
  created_at      timestamptz not null default now()
);
create index feeding_events_colony_idx on public.feeding_events (colony_id, observed_at desc);
create index feeding_events_org_idx on public.feeding_events (organisation_id, observed_at desc);

-- ── cat_sightings (append-only; client-generatable id) ───────────────────────
create table public.cat_sightings (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete cascade,
  cat_id            uuid not null references public.cats (id) on delete cascade,
  feeding_event_id  uuid references public.feeding_events (id) on delete set null,
  feeder_id         uuid references auth.users (id) on delete set null,
  observed_at       timestamptz not null default now(),
  status            public.sighting_status not null,
  note              text,
  created_at        timestamptz not null default now()
);
create index cat_sightings_cat_idx on public.cat_sightings (cat_id, observed_at desc);
create index cat_sightings_org_idx on public.cat_sightings (organisation_id, observed_at);

-- ── incident_urgency_levels (per-org lookup) ─────────────────────────────────
create table public.incident_urgency_levels (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete cascade,
  key                text not null,
  label              text not null,
  sort_order         smallint not null default 0,
  alerts_immediately boolean not null default false,
  created_at         timestamptz not null default now(),
  unique (organisation_id, key)
);
create index incident_urgency_org_idx on public.incident_urgency_levels (organisation_id);

-- ── incidents ────────────────────────────────────────────────────────────────
create table public.incidents (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  colony_id        uuid not null references public.colonies (id) on delete cascade,
  cat_id           uuid references public.cats (id) on delete set null,
  type             public.incident_type not null,
  urgency_level_id uuid references public.incident_urgency_levels (id) on delete set null,
  status           public.incident_status not null default 'open',
  reported_by      uuid references auth.users (id) on delete set null,
  assigned_to      uuid references auth.users (id) on delete set null,
  notes            text,
  occurred_at      timestamptz not null default now(),
  resolved_at      timestamptz,
  resolution_note  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index incidents_org_status_idx on public.incidents (organisation_id, status);
create index incidents_colony_idx on public.incidents (colony_id);
create index incidents_cat_idx on public.incidents (cat_id);
create trigger incidents_set_updated before update on public.incidents
  for each row execute function public.set_updated_at();

-- ── attachments (polymorphic: cats / incidents / colonies) ───────────────────
create table public.attachments (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  entity_type     public.attachment_entity not null,
  entity_id       uuid not null,
  storage_path    text not null,
  content_type    text,
  file_name       text,
  size_bytes      bigint,
  uploaded_by     uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index attachments_entity_idx on public.attachments (entity_type, entity_id) where deleted_at is null;
create index attachments_org_idx on public.attachments (organisation_id);

-- ── alert_settings (1:1 org) ─────────────────────────────────────────────────
create table public.alert_settings (
  organisation_id     uuid primary key references public.organisations (id) on delete cascade,
  not_seen_days       smallint not null default 7,
  repeated_not_seen   smallint not null default 3,
  feeding_missed_hours smallint not null default 12,
  updated_at          timestamptz not null default now()
);
create trigger alert_settings_set_updated before update on public.alert_settings
  for each row execute function public.set_updated_at();

-- ── notifications ────────────────────────────────────────────────────────────
create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  recipient_id    uuid not null references auth.users (id) on delete cascade,
  type            text not null,
  entity_table    text,
  entity_id       uuid,
  channel         public.notif_channel not null default 'in_app',
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index notifications_recipient_idx on public.notifications (recipient_id, read_at);
create index notifications_org_idx on public.notifications (organisation_id);

-- ── audit_log (append-only) ──────────────────────────────────────────────────
create table public.audit_log (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  actor_id        uuid references auth.users (id) on delete set null,
  action          text not null,
  entity_table    text not null,
  entity_id       uuid,
  before          jsonb,
  after           jsonb,
  created_at      timestamptz not null default now()
);
create index audit_log_org_idx on public.audit_log (organisation_id, created_at desc);
create index audit_log_entity_idx on public.audit_log (entity_table, entity_id);

-- ── Seed helper: per-org defaults (called when an org is created, in auth task)
create or replace function public.seed_org_defaults(org uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.incident_urgency_levels (organisation_id, key, label, sort_order, alerts_immediately)
  values (org, 'urgent', 'Urgent', 0, true),
         (org, 'not_urgent', 'Not urgent', 1, false)
  on conflict (organisation_id, key) do nothing;

  insert into public.alert_settings (organisation_id)
  values (org)
  on conflict (organisation_id) do nothing;
end $$;

-- ── RLS: enable everywhere + membership-scoped SELECT (deny-by-default writes)
do $$
declare t text;
begin
  foreach t in array array[
    'colonies','cats','cat_status_history','feeding_schedules','feeding_events',
    'cat_sightings','incident_urgency_levels','incidents','attachments',
    'alert_settings','notifications','audit_log'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- SELECT policies scoped to the caller's organisations. Tables with a
-- deleted_at column additionally hide soft-deleted rows.
create policy "members read colonies" on public.colonies for select
  using (organisation_id in (select public.current_org_ids()) and deleted_at is null);
create policy "members read cats" on public.cats for select
  using (organisation_id in (select public.current_org_ids()) and deleted_at is null);
create policy "members read cat_status_history" on public.cat_status_history for select
  using (organisation_id in (select public.current_org_ids()));
create policy "members read feeding_schedules" on public.feeding_schedules for select
  using (organisation_id in (select public.current_org_ids()) and deleted_at is null);
create policy "members read feeding_events" on public.feeding_events for select
  using (organisation_id in (select public.current_org_ids()));
create policy "members read cat_sightings" on public.cat_sightings for select
  using (organisation_id in (select public.current_org_ids()));
create policy "members read incident_urgency_levels" on public.incident_urgency_levels for select
  using (organisation_id in (select public.current_org_ids()));
create policy "members read incidents" on public.incidents for select
  using (organisation_id in (select public.current_org_ids()));
create policy "members read attachments" on public.attachments for select
  using (organisation_id in (select public.current_org_ids()) and deleted_at is null);
create policy "members read alert_settings" on public.alert_settings for select
  using (organisation_id in (select public.current_org_ids()));
create policy "recipients read own notifications" on public.notifications for select
  using (recipient_id = auth.uid());
create policy "members read audit_log" on public.audit_log for select
  using (organisation_id in (select public.current_org_ids()));
