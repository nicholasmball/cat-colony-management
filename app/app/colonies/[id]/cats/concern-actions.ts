"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveOrg } from "@/lib/active-org";
import { isFailedWrite, writeErrorMessage } from "@/lib/mutation-result";

// Caretaker/Admin-only review actions for the "cats of concern" queue (step 4 of
// the missing-cat process). Mirrors the confirm/reject pattern in
// ./report/actions.ts: requireManagerOrg() is the trust boundary, the cat is
// re-validated as belonging to the caller's active org, writes go through the
// service client scoped to org + id (+ status for the audited status changes),
// and isFailedWrite turns a 0-row match into a surfaced error, never a false
// success. Nothing is ever auto-actioned — every row here is a human decision.

const ACTIVE_STATUS = "active";
const MISSING_STATUS = "missing";

// A manager (admin/caretaker) of the active org. Mirrors report/actions.ts.
async function requireManagerOrg() {
  const org = await getActiveOrg();
  if (!org) redirect("/app");
  if (org.role !== "admin" && org.role !== "caretaker") redirect("/app/today");
  return org;
}

// Shared setup every concern action needs: the manager org, the route params,
// the session user (for reviewed_by), and a re-validated cat that belongs to the
// active org and isn't deleted. Returns the bits the caller needs or fails to
// the cat detail page with an ?error= redirect (mirrors reportCat's check).
async function resolveTarget(formData: FormData) {
  const org = await requireManagerOrg();
  const colonyId = String(formData.get("colony_id"));
  const catId = String(formData.get("cat_id"));
  const detail = `/app/colonies/${colonyId}/cats/${catId}`;
  function fail(message: string): never {
    redirect(`${detail}?error=${encodeURIComponent(message)}`);
  }

  // reviewed_by is the authenticated session user, never form input — same trust
  // boundary as cats.confirmed_by / incidents.reported_by. The service client
  // carries no session, so read the user from the RLS-bound client first.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Cross-org write integrity: catId comes from the route and is
  // attacker-controlled. Re-validate it belongs to the caller's active org and
  // isn't deleted before any write (mirrors reportCat's colony-ownership check).
  const { data: cat } = await supabase
    .from("cats")
    .select("id, status")
    .eq("id", catId)
    .eq("organisation_id", org.organisation_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!cat) fail("Cat not found.");

  return { org, colonyId, catId, detail, fail, userId: user?.id ?? null };
}

// Insert a concern-review row (ignored | monitoring). Both share the same path:
// the only difference is the outcome value and the success message. RLS
// ("managers insert cat_concern_reviews") already gates the write to managers,
// but we keep the requireManagerOrg() UI/role guard for a clean redirect.
async function recordReview(
  formData: FormData,
  outcome: "ignored" | "monitoring",
  successKey: string,
) {
  const { org, colonyId, catId, detail, fail, userId } =
    await resolveTarget(formData);
  const note = String(formData.get("note") ?? "").trim() || null;

  const svc = createServiceClient();
  const { data, error } = await svc
    .from("cat_concern_reviews")
    .insert({
      organisation_id: org.organisation_id,
      cat_id: catId,
      outcome,
      note,
      reviewed_by: userId,
    })
    .select("id");

  if (isFailedWrite({ error, rows: data })) {
    fail(
      writeErrorMessage({ error, rows: data }, "Couldn’t record the review."),
    );
  }

  revalidatePath(`/app/colonies/${colonyId}`);
  revalidatePath(detail);
  redirect(`${detail}?${successKey}=1`);
}

// ── ignoreConcern ────────────────────────────────────────────────────────────
// "I've looked, no action needed." Clears the cat from the queue until a fresh
// non-seen/concern signal arrives after this review (time-anchored in
// lib/cat-concern.ts).
export async function ignoreConcern(formData: FormData) {
  await recordReview(formData, "ignored", "ignored");
}

// ── monitorConcern ───────────────────────────────────────────────────────────
// "Keep watching." Stays visible in the distinct Monitoring sub-group rather
// than the active candidates list.
export async function monitorConcern(formData: FormData) {
  await recordReview(formData, "monitoring", "monitoring");
}

// ── markCatMissing ───────────────────────────────────────────────────────────
// Caretaker/Admin only. active → missing. Guarded `.eq("status","active")` so it
// can never fire on a cat that's already missing/deceased/etc. The status change
// is audited by the log_cat_status_change trigger (0002_domain) — NOT recorded
// in cat_concern_reviews. isFailedWrite turns a 0-row match (stale/foreign id,
// or already missing) into a surfaced error. Reversible via markCatFound.
export async function markCatMissing(formData: FormData) {
  const { org, colonyId, catId, detail, fail } = await resolveTarget(formData);

  const svc = createServiceClient();
  const { data, error } = await svc
    .from("cats")
    .update({ status: MISSING_STATUS })
    .eq("id", catId)
    .eq("organisation_id", org.organisation_id)
    .eq("status", ACTIVE_STATUS)
    .is("deleted_at", null)
    .select("id");

  if (isFailedWrite({ error, rows: data })) {
    fail(
      writeErrorMessage(
        { error, rows: data },
        "This cat can’t be marked missing — it isn’t active anymore.",
      ),
    );
  }

  revalidatePath(`/app/colonies/${colonyId}`);
  revalidatePath(detail);
  redirect(`${detail}?missing=1`);
}

// ── markCatFound ─────────────────────────────────────────────────────────────
// Caretaker/Admin only. The approved reversal: missing → active. Guarded
// `.eq("status","missing")` so it only acts on a currently-missing cat. Same
// trust boundary + status guard + isFailedWrite + trigger-audited status change
// as markCatMissing.
export async function markCatFound(formData: FormData) {
  const { org, colonyId, catId, detail, fail } = await resolveTarget(formData);

  const svc = createServiceClient();
  const { data, error } = await svc
    .from("cats")
    .update({ status: ACTIVE_STATUS })
    .eq("id", catId)
    .eq("organisation_id", org.organisation_id)
    .eq("status", MISSING_STATUS)
    .is("deleted_at", null)
    .select("id");

  if (isFailedWrite({ error, rows: data })) {
    fail(
      writeErrorMessage(
        { error, rows: data },
        "This cat can’t be marked found — it isn’t missing anymore.",
      ),
    );
  }

  revalidatePath(`/app/colonies/${colonyId}`);
  revalidatePath(detail);
  redirect(`${detail}?found=1`);
}
