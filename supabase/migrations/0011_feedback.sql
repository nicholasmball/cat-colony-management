-- 0011_feedback — in-app feedback / bug-report channel for UAT.
--
-- One free-text feedback row per submission (kind = bug|idea), written by any
-- org member from /app/feedback. A separate out-of-band bot polls status='new'
-- rows and turns them into board cards (then sets status / vibecodes_task_id via
-- the service role, which bypasses RLS). The security model:
--   • INSERT  — a member may write ONLY a row for THEIR active org, attributed to
--               THEMSELVES (reporter_id = auth.uid()); the DB enforces this even
--               if the server action is bypassed.
--   • SELECT  — a member may read ONLY their own rows.
--   • no member UPDATE/DELETE policy — members can never flip status or
--     vibecodes_task_id; only the service role (RLS-exempt) moves those.
-- Attribution FKs follow the project convention: org cascades, reporter_id is
-- ON DELETE SET NULL so the GDPR erase path (eraseMember) anonymises history
-- rather than deleting the feedback row.

create table public.feedback (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  reporter_id      uuid references auth.users (id) on delete set null,
  reporter_role    text,
  kind             text not null check (kind in ('bug', 'idea')),
  message          text not null,
  page_url         text,
  locale           text,
  app_version      text,
  user_agent       text,
  screenshot_key   text,
  status           text not null default 'new',
  vibecodes_task_id text,
  created_at       timestamptz not null default now()
);

-- Bot poll: newest pending feedback first.
create index feedback_status_created_idx on public.feedback (status, created_at);
-- Org scoping.
create index feedback_org_idx on public.feedback (organisation_id);

alter table public.feedback enable row level security;

-- INSERT: a member may write a row only for their active org, attributed to
-- themselves. has_org_role with all three roles == "is a member of this org".
create policy "member inserts own org feedback" on public.feedback for insert
  with check (
    reporter_id = auth.uid()
    and public.has_org_role(
      organisation_id,
      '{admin,caretaker,feeder}'::public.app_role[]
    )
  );

-- SELECT: a member may read only their own rows. (Managers do NOT get a triage
-- view here — the board is the triage surface, fed by the service-role bot.)
create policy "member reads own feedback" on public.feedback for select
  using (reporter_id = auth.uid());

-- No UPDATE or DELETE policy: members can never change status / vibecodes_task_id
-- (AC23). The service role bypasses RLS and owns those transitions.
