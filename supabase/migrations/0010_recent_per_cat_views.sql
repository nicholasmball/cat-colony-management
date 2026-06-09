-- 0010_recent_per_cat_views — per-cat "most recent K" views for the dashboard's
-- org-wide cats-of-concern roll-up.
--
-- Builds on 0002_domain (cat_sightings + its (cat_id, observed_at desc) index)
-- and 0008_cat_concern_reviews (cat_concern_reviews + its (cat_id, created_at
-- desc) index), plus the SELECT policies on both base tables.
--
-- Problem this fixes (hardening): app/app/dashboard/page.tsx read cat_sightings
-- (and cat_concern_reviews) with a single GLOBAL `.limit(5000)` backstop ordered
-- (cat_id, observed_at desc), then bounded per cat in memory via capRowsPerKey
-- (K=10). The global 5000 ceiling truncates by cat_id UUID order: once an org
-- has > ~5000 sighting rows, cats whose UUIDs sort highest can have their
-- not-seen rows cut BEFORE the per-cat cap ever sees them, silently dropping a
-- quiet cat from the concern roll-up.
--
-- Fix: move the per-cat bound into Postgres. Each view returns, PER cat, only
-- the most recent K rows via row_number() over (partition by cat_id order by
-- <time> desc) <= K. K matches lib/dashboard.ts PER_CAT_SIGHTING_CAP (10) — the
-- generous headroom over the default repeated-not-seen rule. The dashboard reads
-- these views (org-scoped) instead of the base tables, so there is no global
-- ceiling to truncate and every cat keeps its own recent run regardless of how
-- noisy its neighbours are. concernCandidate's detection is unchanged.
--
-- security_invoker = on: the view runs with the CALLER's privileges, so the
-- existing base-table RLS ("members read in-org") still applies — org-scoping
-- and access are preserved exactly, NOT widened. The org filter is still applied
-- explicitly in the query (defence in depth + index use). organisation_id is
-- carried through so the dashboard can keep filtering by it.
--
-- Additive + safe: creating views grants no new access and touches no existing
-- data. The partitioning indexes already exist (0002:164, 0008:37) — nothing to
-- add. K is a literal here so the views are plain (no parameterised function).

-- ── cat_recent_sightings: most-recent K sightings per cat ────────────────────
create or replace view public.cat_recent_sightings
with (security_invoker = on) as
select id, organisation_id, cat_id, status, observed_at
from (
  select s.id,
         s.organisation_id,
         s.cat_id,
         s.status,
         s.observed_at,
         row_number() over (
           partition by s.cat_id
           order by s.observed_at desc, s.id desc
         ) as rn
  from public.cat_sightings s
) ranked
where rn <= 10;

-- ── cat_recent_concern_reviews: most-recent K reviews per cat ────────────────
create or replace view public.cat_recent_concern_reviews
with (security_invoker = on) as
select id, organisation_id, cat_id, outcome, created_at
from (
  select r.id,
         r.organisation_id,
         r.cat_id,
         r.outcome,
         r.created_at,
         row_number() over (
           partition by r.cat_id
           order by r.created_at desc, r.id desc
         ) as rn
  from public.cat_concern_reviews r
) ranked
where rn <= 10;
