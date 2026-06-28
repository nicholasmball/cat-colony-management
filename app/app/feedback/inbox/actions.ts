"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveOrg } from "@/lib/active-org";
import { isInAppPath } from "@/lib/feedback-inbox";
import {
  validateResolutionNote,
  shouldNotifyReporter,
  feedbackSnippet,
} from "@/lib/feedback-resolve";

const INBOX = "/app/feedback/inbox";

// The result the client form acts on. Success flips the row to its terminal
// Resolved state on the next render (revalidatePath); failure keeps the inline
// confirm open with the message.
export type ResolveFeedbackResult = { ok: true } | { ok: false; error: string };

// The columns the resolving UPDATE returns — drives the (best-effort) reporter
// notification. reporter_id may be null (anonymised). page_url is the deep-link
// candidate; message becomes the notification snippet.
type ResolvedFeedbackRow = {
  id: string;
  reporter_id: string | null;
  page_url: string | null;
  message: string;
};

// resolveFeedback — admin-only. Marks one feedback row resolved (status +
// who/when/note), idempotently, then best-effort notifies the reporter in-app.
//
// SECURITY: the admin gate is RE-CHECKED here (never trust the client) — the
// inbox UI hides this control, but the server is the trust boundary. The write
// uses the service role (members have no UPDATE policy on feedback, by design in
// 0011) and is HARD-SCOPED to the caller's active org, so a foreign id can never
// be touched.
export async function resolveFeedback(args: {
  feedbackId: string;
  note: string;
}): Promise<ResolveFeedbackResult> {
  const tErr = await getTranslations("errors");

  const org = await getActiveOrg();
  if (!org || org.role !== "admin") {
    return { ok: false, error: tErr("notAllowed") };
  }

  const feedbackId = String(args.feedbackId ?? "").trim();
  if (!feedbackId) return { ok: false, error: tErr("feedbackResolveFailed") };

  // Validate the OPTIONAL note: trim, empty→null, reject 501+.
  const note = validateResolutionNote(args.note);
  if (!note.ok) return { ok: false, error: tErr("resolveNoteTooLong") };

  // The resolver's id, from the session (never the client).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: tErr("notAllowed") };

  const svc = createServiceClient();
  // status <> 'resolved' makes this idempotent: a second resolve (already
  // resolved / not in this org / not found) matches 0 rows → benign no-op.
  const { data, error } = await svc
    .from("feedback")
    .update({
      status: "resolved",
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
      resolution_note: note.value,
    })
    .eq("id", feedbackId)
    .eq("organisation_id", org.organisation_id)
    .neq("status", "resolved")
    .select("id, reporter_id, page_url, message");

  if (error) return { ok: false, error: tErr("feedbackResolveFailed") };

  const row = (data?.[0] ?? null) as ResolvedFeedbackRow | null;
  // 0 rows updated → already resolved / foreign / gone. No-op, NO notification.
  if (!row) {
    revalidatePath(INBOX);
    return { ok: true };
  }

  // Best-effort in-app notification to the reporter (never to yourself). A
  // failure here MUST NOT roll back or fail the resolve — catch + log only.
  if (
    shouldNotifyReporter({ reporterId: row.reporter_id, resolverId: user.id })
  ) {
    try {
      // Deep-link to the reporter's own in-app page when it's a safe /app route;
      // otherwise a generic in-app destination — NEVER the admin inbox.
      const href = isInAppPath(row.page_url) ? row.page_url : "/app/feedback";
      const insertErr = await svc.from("notifications").insert({
        organisation_id: org.organisation_id,
        recipient_id: row.reporter_id,
        type: "feedback_resolved",
        severity: "routine",
        message_key: "feedback_resolved",
        // Rendered in the reporter's locale at view time (alerts.feedback_resolved.*).
        message_params: {
          snippet: feedbackSnippet(row.message),
          note: note.value ?? "",
          href,
        },
        channels: ["in_app"],
        dedup_key: `feedback_resolved:${row.id}`,
      });
      if (insertErr.error) throw insertErr.error;
    } catch (e) {
      // Non-blocking: the resolve already committed.
      console.error("resolveFeedback: reporter notification failed", e);
    }
  }

  revalidatePath(INBOX);
  return { ok: true };
}
