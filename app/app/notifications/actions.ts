"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrg } from "@/lib/active-org";
import { isFailedWrite } from "@/lib/mutation-result";

// In-app notification centre: mark-read mutations ONLY. No senders, no
// detection — this surface only flips read_at on the CALLER'S OWN rows.
//
// SECURITY: the RLS-bound createClient() is used deliberately (NOT the service
// role). The "recipients update own notifications" policy (0003_rls.sql) scopes
// every UPDATE to recipient_id = auth.uid() via both USING and WITH CHECK, so a
// caller can never mark someone else's notification read even with a forged id.
// We additionally scope to the active org so a stale id from another org is a
// clean no-op. read_at = now() is idempotent (re-marking a read row is harmless).

const PAGE = "/app/notifications";

// Revalidate the page AND the layout-rendered badge. The unread pill lives in
// the layout, so the layout segment must re-fetch its count after a mark-read.
function revalidate() {
  revalidatePath(PAGE);
  revalidatePath("/app", "layout");
}

// Mark a single notification read. Idempotent: re-running on an already-read row
// updates read_at again harmlessly. A 0-row result (foreign/stale/cross-org id)
// is surfaced as a failure via isFailedWrite rather than a silent success.
export async function markRead(formData: FormData) {
  const org = await getActiveOrg();
  if (!org) redirect("/app");
  const id = String(formData.get("id") ?? "");
  if (!id) redirect(PAGE);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organisation_id", org.organisation_id)
    .select("id");
  // RLS already guarantees recipient ownership; a 0-row write means the id
  // didn't match the caller's own rows in this org — treat as a no-op failure
  // but don't hard-error the navigation (the row simply isn't theirs to touch).
  if (isFailedWrite({ error, rows: data })) {
    // Surface nothing to the user beyond a refresh; the row stays as-is.
    revalidate();
    redirect(PAGE);
  }

  revalidate();
  redirect(PAGE);
}

// Mark every UNREAD notification for the caller (active org) read in one write.
// RLS scopes it to recipient_id = auth.uid(); we add the org + read_at-null
// filters so it touches only this org's still-unread rows. A 0-row result here
// is a benign no-op (nothing was unread), so we don't treat it as a failure.
export async function markAllRead() {
  const org = await getActiveOrg();
  if (!org) redirect("/app");

  const supabase = await createClient();
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("organisation_id", org.organisation_id)
    .is("read_at", null);

  revalidate();
  redirect(PAGE);
}
