-- 0009_alert_engine — turn the placeholder notifications table into the alert
-- engine's record store (detection + fan-out only; no senders, no UI).
--
-- Builds on 0002_domain (the notifications table + notif_channel enum,
-- alert_settings thresholds, incident_urgency_levels) and 0003_rls (the
-- recipients-read-own / recipients-update-own / system-insert policy set). The
-- engine (lib/alert-engine.ts) plans one logical alert per detected condition,
-- fans it out to one row PER recipient (caretakers + admins), and stores a
-- message_key + message_params blob — NOT rendered text — so the same row reads
-- English to one caretaker and Portuguese to another at display time.
--
-- This is an ALTER, not a new table: the placeholder notifications shape from
-- 0002 (freeform `type` text, single `channel`, entity_table/entity_id) is empty
-- pre-launch, so we re-type `type` to a real enum and add the columns the engine
-- needs (severity, message_key/params, typed FKs, a channels array, a dispatch
-- marker, a dedup key). Idempotency is structural: a UNIQUE (recipient_id,
-- dedup_key) index turns every insert into ON CONFLICT DO NOTHING — a re-scan or
-- a double event can never raise the same alert to the same person twice.
--
-- No NEW RLS here: 0002/0003 already deliver "recipients read own", "recipients
-- update own (mark read)" and system-insert (the engine writes via the service
-- role, which bypasses RLS by design for the cross-org fan-out). notif_channel
-- already carries all four channels (in_app, email, push, sms) — nothing to add.
-- dispatched_at is recorded but always NULL on insert: actual push/SMS/email
-- sending is a separate later card; this card only records the channel INTENT.

-- ── notif_type enum: the closed set of alert kinds the engine can raise ───────
create type public.notif_type as enum (
  'feeding_missed',
  'incident_urgent',
  'incident_routine',
  'new_cat',
  'concern',
  'not_seen'
);

-- ── Re-type the freeform `type` column to the enum (table is empty pre-launch).
-- The old default ('' is none) and any value are dropped with the column; the
-- new column is NOT NULL because every engine-planned row carries a type.
alter table public.notifications
  drop column type;
alter table public.notifications
  add column type public.notif_type not null;

-- ── Severity (two tiers, mirrors the org incident-urgency model) ─────────────
alter table public.notifications
  add column severity text check (severity in ('urgent', 'routine'));

-- ── Render inputs: a message catalog key + a JSON params blob (never text) ────
alter table public.notifications
  add column message_key text;
alter table public.notifications
  add column message_params jsonb not null default '{}'::jsonb;

-- ── Typed subject FKs (all nullable; an alert points at whichever apply). On
-- delete cascade: if the colony/cat/incident is removed, its alerts go too. ───
alter table public.notifications
  add column colony_id uuid references public.colonies (id) on delete cascade;
alter table public.notifications
  add column cat_id uuid references public.cats (id) on delete cascade;
alter table public.notifications
  add column incident_id uuid references public.incidents (id) on delete cascade;

-- ── Channel intent (urgent → push+sms, routine → in_app+email). An ARRAY of the
-- existing notif_channel enum so one row carries every intended channel; the old
-- singular `channel` column from 0002 stays for back-compat but the engine uses
-- this. Default {in_app} keeps any hand-inserted row sane. ────────────────────
alter table public.notifications
  add column channels public.notif_channel[] not null default '{in_app}';

-- ── Dispatch marker: ALWAYS null on insert (this card records, never sends). A
-- later channel card stamps it when a real push/SMS/email actually goes out. ──
alter table public.notifications
  add column dispatched_at timestamptz;

-- ── Dedup key: the engine's idempotency anchor. Shapes (lib/alert-engine.ts):
--   feeding_missed:{colony}:{window}:{localDate}  (per-window since 0013; {window}
--     is the colony_feeding_windows id, or "p{position}" as a fallback)
--   incident_urgent:{id} / incident_routine:{id}
--   new_cat:{cat}
--   concern:{cat}:{observed_at}
--   not_seen:{cat}:{streakStart}
-- NOT NULL: a row without a dedup key can't participate in the unique gate. ────
alter table public.notifications
  add column dedup_key text not null;

-- ── Idempotency: one logical alert per recipient. INSERT … ON CONFLICT
-- (recipient_id, dedup_key) DO NOTHING relies on this unique index, so a
-- re-scan or a double event is a no-op, not a duplicate. ──────────────────────
create unique index notifications_recipient_dedup_idx
  on public.notifications (recipient_id, dedup_key);

-- ── List/feed index: the in-app centre (next card) reads an org's alerts newest
-- first, filterable by type. ─────────────────────────────────────────────────
create index notifications_org_type_created_idx
  on public.notifications (organisation_id, type, created_at desc);
