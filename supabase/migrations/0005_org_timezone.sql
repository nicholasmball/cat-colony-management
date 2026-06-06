-- 0005_org_timezone — per-organisation timezone for "today" semantics.
--
-- Builds on 0001_init (public.organisations). Day boundaries — what counts as
-- "today" for feeds, schedules and the missed-feed alert window — are decided
-- in the org's local zone, not the server's UTC. Default Europe/Lisbon (SCoT's
-- home zone); modelled per-org so multi-org tenants in other regions Just Work.
--
-- Existing rows are backfilled by the column default (NOT NULL + default), so
-- no separate UPDATE is needed. Validation of the IANA zone string is enforced
-- in the app layer (lib/time.isValidTimeZone) on write.

alter table public.organisations
  add column timezone text not null default 'Europe/Lisbon';
