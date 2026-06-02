-- 0003_rls — write/role-matrix policies (deny-by-default → role-scoped writes).
--
-- Roles come from memberships(user, org, role) via has_org_role(). SELECT
-- policies already exist (0001/0002); this migration adds INSERT/UPDATE/DELETE.
-- Decisions (owner-approved): Caretakers manage ALL colonies in their org;
-- incidents closed by Admin/Caretaker only (Q18); append-only event tables are
-- insert-only for any member; deletes are soft (Admin/Caretaker via UPDATE).
--
-- Helper shorthands used below:
--   member  = organisation_id in (select public.current_org_ids())
--   manager = public.has_org_role(organisation_id, '{admin,caretaker}')
--   admin   = public.has_org_role(organisation_id, '{admin}')

-- The cat status-history trigger must always write, regardless of the caller's
-- RLS — make it SECURITY DEFINER so the audit trail can't be bypassed/blocked.
create or replace function public.log_cat_status_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    insert into public.cat_status_history
      (organisation_id, cat_id, old_status, new_status, changed_by)
    values (new.organisation_id, new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end $$;

-- ── organisations: Admin updates own org (creation handled by onboarding RPC)
create policy "admin updates organisation" on public.organisations for update
  using (public.has_org_role(id, '{admin}'::public.app_role[]))
  with check (public.has_org_role(id, '{admin}'::public.app_role[]));

-- ── memberships: Admin/Caretaker read the team; Admin manages members
create policy "managers read org memberships" on public.memberships for select
  using (public.has_org_role(organisation_id, '{admin,caretaker}'::public.app_role[]));
create policy "admin inserts memberships" on public.memberships for insert
  with check (public.has_org_role(organisation_id, '{admin}'::public.app_role[]));
create policy "admin updates memberships" on public.memberships for update
  using (public.has_org_role(organisation_id, '{admin}'::public.app_role[]))
  with check (public.has_org_role(organisation_id, '{admin}'::public.app_role[]));

-- ── colonies: Admin/Caretaker manage
create policy "managers insert colonies" on public.colonies for insert
  with check (public.has_org_role(organisation_id, '{admin,caretaker}'::public.app_role[]));
create policy "managers update colonies" on public.colonies for update
  using (public.has_org_role(organisation_id, '{admin,caretaker}'::public.app_role[]))
  with check (public.has_org_role(organisation_id, '{admin,caretaker}'::public.app_role[]));

-- ── cats: Admin/Caretaker manage; Feeders may report a NEW unconfirmed cat
create policy "insert cats" on public.cats for insert
  with check (
    organisation_id in (select public.current_org_ids())
    and (
      public.has_org_role(organisation_id, '{admin,caretaker}'::public.app_role[])
      or (public.has_org_role(organisation_id, '{feeder}'::public.app_role[]) and status = 'new_unconfirmed')
    )
  );
create policy "managers update cats" on public.cats for update
  using (public.has_org_role(organisation_id, '{admin,caretaker}'::public.app_role[]))
  with check (public.has_org_role(organisation_id, '{admin,caretaker}'::public.app_role[]));

-- ── feeding_schedules: Admin/Caretaker manage
create policy "managers insert feeding_schedules" on public.feeding_schedules for insert
  with check (public.has_org_role(organisation_id, '{admin,caretaker}'::public.app_role[]));
create policy "managers update feeding_schedules" on public.feeding_schedules for update
  using (public.has_org_role(organisation_id, '{admin,caretaker}'::public.app_role[]))
  with check (public.has_org_role(organisation_id, '{admin,caretaker}'::public.app_role[]));

-- ── feeding_events: append-only; any member of the org may record a feed
create policy "members insert feeding_events" on public.feeding_events for insert
  with check (organisation_id in (select public.current_org_ids()));

-- ── cat_sightings: append-only; any member may record a sighting
create policy "members insert cat_sightings" on public.cat_sightings for insert
  with check (organisation_id in (select public.current_org_ids()));

-- ── incident_urgency_levels: Admin/Caretaker manage the lookup
create policy "managers insert urgency_levels" on public.incident_urgency_levels for insert
  with check (public.has_org_role(organisation_id, '{admin,caretaker}'::public.app_role[]));
create policy "managers update urgency_levels" on public.incident_urgency_levels for update
  using (public.has_org_role(organisation_id, '{admin,caretaker}'::public.app_role[]))
  with check (public.has_org_role(organisation_id, '{admin,caretaker}'::public.app_role[]));
create policy "managers delete urgency_levels" on public.incident_urgency_levels for delete
  using (public.has_org_role(organisation_id, '{admin,caretaker}'::public.app_role[]));

-- ── incidents: any member may report; only Admin/Caretaker triage/close (Q18)
create policy "members insert incidents" on public.incidents for insert
  with check (organisation_id in (select public.current_org_ids()));
create policy "managers update incidents" on public.incidents for update
  using (public.has_org_role(organisation_id, '{admin,caretaker}'::public.app_role[]))
  with check (public.has_org_role(organisation_id, '{admin,caretaker}'::public.app_role[]));

-- ── attachments: any member may attach; Admin/Caretaker may soft-delete (update)
create policy "members insert attachments" on public.attachments for insert
  with check (organisation_id in (select public.current_org_ids()));
create policy "managers update attachments" on public.attachments for update
  using (public.has_org_role(organisation_id, '{admin,caretaker}'::public.app_role[]))
  with check (public.has_org_role(organisation_id, '{admin,caretaker}'::public.app_role[]));

-- ── alert_settings: Admin/Caretaker manage thresholds
create policy "managers upsert alert_settings" on public.alert_settings for insert
  with check (public.has_org_role(organisation_id, '{admin,caretaker}'::public.app_role[]));
create policy "managers update alert_settings" on public.alert_settings for update
  using (public.has_org_role(organisation_id, '{admin,caretaker}'::public.app_role[]))
  with check (public.has_org_role(organisation_id, '{admin,caretaker}'::public.app_role[]));

-- ── notifications: recipients mark their own read; inserts are system-only
--    (alert engine uses the service role, which bypasses RLS).
create policy "recipients update own notifications" on public.notifications for update
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- ── audit_log: tighten read to Admin/Caretaker (oversight). Replaces the
--    org-wide read policy from 0002. Inserts are system/trigger-only.
drop policy if exists "members read audit_log" on public.audit_log;
create policy "managers read audit_log" on public.audit_log for select
  using (public.has_org_role(organisation_id, '{admin,caretaker}'::public.app_role[]));

-- NOTE (follow-ups, not in this task):
--  * Feeder "add a note to an incident without closing it" needs an
--    incident_comments table — handled by the Incident triage task.
--  * Org creation + first-admin bootstrap is a SECURITY DEFINER RPC in the
--    Auth/onboarding task (organisations INSERT intentionally has no user policy).
