-- 0013_colony_feeding_windows — multiple daily feeding windows per colony (Option A).
--
-- The MVP modelled a single daily feeding window as two columns on `colonies`
-- (feeding_window_start/end). SCoT colonies are often fed more than once a day
-- (a morning AND an evening feed), so this adds a child table holding up to 4
-- ORDERED windows per colony — each a start + end time. The display surfaces
-- (colony list/detail, Today, dashboard) and the missed-feed alert sweep all
-- move to reading windows from here; the missed-feed sweep becomes PER WINDOW
-- (a colony can be "morning fed, evening missed").
--
-- ADDITIVE + backwards-safe:
--   • The legacy colonies.feeding_window_start/end columns are KEPT and stay in
--     sync from window position 1 (the server actions write both), so anything
--     still reading the colony columns during cutover sees a coherent value.
--   • Backfill seeds window 1 from each colony's existing single window, so no
--     colony loses its time. A colony with BOTH legacy columns null gets NO row
--     (0 windows is a valid state — "No feeding time set").
--
-- RLS mirrors `colonies` (0002 select + 0003 write matrix): any org member reads
-- their org's windows; only Admin/Caretaker (has_org_role) write them. Org
-- scoping is via the same current_org_ids()/has_org_role() helpers, and the
-- organisation_id column is carried on the row (not joined) so the policies stay
-- a cheap index lookup, exactly like every other domain table.

create table public.colony_feeding_windows (
  id               uuid primary key default gen_random_uuid(),
  colony_id        uuid not null references public.colonies (id) on delete cascade,
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  window_start     time,
  window_end       time,
  position         int not null default 1,
  created_at       timestamptz not null default now()
);

-- Read/group windows for one or many colonies in start order (colony_id, position).
create index colony_feeding_windows_colony_idx
  on public.colony_feeding_windows (colony_id, position);

alter table public.colony_feeding_windows enable row level security;

-- ── SELECT: any org member reads their org's windows (mirrors "members read
-- colonies", 0002). No deleted_at column here — windows are hard-replaced. ─────
create policy "members read colony_feeding_windows"
  on public.colony_feeding_windows for select
  using (organisation_id in (select public.current_org_ids()));

-- ── WRITE: Admin/Caretaker manage, mirroring the colonies write matrix (0003).
-- INSERT/UPDATE/DELETE so the edit action can hard-replace a colony's windows. ─
create policy "managers insert colony_feeding_windows"
  on public.colony_feeding_windows for insert
  with check (public.has_org_role(organisation_id, '{admin,caretaker}'::public.app_role[]));
create policy "managers update colony_feeding_windows"
  on public.colony_feeding_windows for update
  using (public.has_org_role(organisation_id, '{admin,caretaker}'::public.app_role[]))
  with check (public.has_org_role(organisation_id, '{admin,caretaker}'::public.app_role[]));
create policy "managers delete colony_feeding_windows"
  on public.colony_feeding_windows for delete
  using (public.has_org_role(organisation_id, '{admin,caretaker}'::public.app_role[]));

-- ── Backfill: one window (position 1) per colony that has a legacy single
-- window. Both-null colonies get no row (0 windows = valid). ──────────────────
insert into public.colony_feeding_windows
  (colony_id, organisation_id, window_start, window_end, position)
select id, organisation_id, feeding_window_start, feeding_window_end, 1
from public.colonies
where feeding_window_start is not null or feeding_window_end is not null;
