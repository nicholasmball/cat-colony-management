-- 0012_feedback_resolve — let an admin RESOLVE a feedback row + record who/when/why.
--
-- Additive only. Three nullable columns on the existing feedback table (0011) so
-- an admin can close out a UAT report from the inbox:
--   • resolved_at     — when it was resolved (NULL = still open).
--   • resolved_by     — which admin resolved it. ON DELETE SET NULL mirrors
--                       reporter_id (0011): the GDPR erase path anonymises the
--                       audit trail rather than dropping the feedback row.
--   • resolution_note — the optional note shown to the reporter (≤500 chars,
--                       enforced in the server action — kept free-text here).
-- We DO NOT add a status CHECK constraint: `status` stays free-text (an
-- out-of-band bot already writes 'new'/'queued'/etc.), and 'resolved' is just one
-- more value the inbox renders with its own terminal badge. No RLS change is
-- needed — members still have no UPDATE policy; only the service role (which the
-- resolve action uses) writes these columns.
alter table public.feedback
  add column resolved_at     timestamptz,
  add column resolved_by     uuid references auth.users (id) on delete set null,
  add column resolution_note text;

-- ── notif_type: add the 'feedback_resolved' kind ─────────────────────────────
-- The in-app notification sent to the reporter when their feedback is resolved
-- reuses the existing notifications store (lib/alert-persist shape). That table's
-- `type` is the CLOSED enum public.notif_type (0009), so the new kind must be
-- registered here before any such row can be inserted. ADD VALUE is additive and
-- safe to run on its own (PG12+ permits it outside an explicit value-use in the
-- same statement); the value is rendered in the reporter's locale at display
-- time from message_key/params (alerts.feedback_resolved.*), like every alert.
alter type public.notif_type add value if not exists 'feedback_resolved';
