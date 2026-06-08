"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveOrg } from "@/lib/active-org";
import { isFailedWrite, writeErrorMessage } from "@/lib/mutation-result";
import {
  UNCONFIRMED_STATUS,
  hasReportIdentifier,
  parseNeutered,
} from "@/lib/cat-report";

// A manager (admin/caretaker) of the active org may confirm/reject a reported
// cat. Mirrors the schedules/incidents actions' requireManagerOrg — the UI also
// hides these, but the server is the trust boundary and never trusts that.
async function requireManagerOrg() {
  const org = await getActiveOrg();
  if (!org) redirect("/app");
  if (org.role !== "admin" && org.role !== "caretaker") redirect("/app/today");
  return org;
}

// ── reportCat ────────────────────────────────────────────────────────────────
// Any org member (incl. feeders) may report a new cat. RLS ("insert cats")
// permits a feeder INSERT only while status = 'new_unconfirmed', so we use the
// RLS-bound createClient(), NOT the service role. The colony comes from the
// trusted route param; the org from getActiveOrg(). At least one identifier
// (name OR description) is required — everything else is optional and never
// blocks the report.
export async function reportCat(formData: FormData) {
  const colonyId = String(formData.get("colony_id"));
  const org = await getActiveOrg();
  if (!org) redirect("/app");

  const reportPath = `/app/colonies/${colonyId}/cats/report`;
  function fail(message: string): never {
    redirect(`${reportPath}?error=${encodeURIComponent(message)}`);
  }

  const name = String(formData.get("name") ?? "").trim() || null;
  const tempId = String(formData.get("temp_id") ?? "").trim() || null;
  if (!hasReportIdentifier({ name, temp_id: tempId })) {
    fail("Add a name or a short description so the cat can be identified.");
  }

  const colour = String(formData.get("colour") ?? "").trim() || null;
  const sex = String(formData.get("sex") ?? "").trim() || null;
  // Tri-state so "unknown" stays null — records accept incomplete data.
  const neutered = parseNeutered(formData.get("neutered")?.toString());
  const notes = String(formData.get("notes") ?? "").trim() || null;

  // Non-blocking photo: the key was presigned + PUT by the browser (entityType
  // "cat_report", colony-scoped). We store it on photo_url at insert; if the
  // upload failed the key is empty and the report still saves.
  const photoKey = String(formData.get("photo_key") ?? "").trim() || null;

  const supabase = await createClient();

  // Cross-org write integrity: the route-param colony_id is attacker-controlled,
  // and RLS ("insert cats") only checks org membership + status — there is no DB
  // constraint tying cats.colony_id to cats.organisation_id. So we re-validate
  // here that the colony exists AND belongs to the caller's active org before
  // inserting, mirroring the presign cat_report branch. Without this, an Org A
  // member could pass an Org B colony_id and create an orphaned row.
  const { data: colony } = await supabase
    .from("colonies")
    .select("id")
    .eq("id", colonyId)
    .eq("organisation_id", org.organisation_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!colony) fail("Colony not found.");

  const { error } = await supabase.from("cats").insert({
    organisation_id: org.organisation_id,
    colony_id: colonyId,
    name,
    temp_id: tempId,
    colour,
    sex,
    neutered,
    notes,
    photo_url: photoKey,
    status: UNCONFIRMED_STATUS,
  });

  if (error) fail(error.message);

  revalidatePath(`/app/colonies/${colonyId}`);
  // Honest "we'll review it" copy lives on the colony page, keyed by ?reported.
  redirect(`/app/colonies/${colonyId}?reported=cat`);
}

// ── confirmCat ───────────────────────────────────────────────────────────────
// Caretaker/Admin only. Promotes a reported cat new_unconfirmed → active. The
// status filter means Confirm can never re-fire on an already-active cat.
// Mirrors the colonies/incidents pattern: requireManagerOrg is the trust
// boundary; the service client writes scoped to org + id + status, and
// isFailedWrite turns a 0-row match (foreign/stale id, or already confirmed)
// into a surfaced error instead of a false success.
export async function confirmCat(formData: FormData) {
  const org = await requireManagerOrg();
  const colonyId = String(formData.get("colony_id"));
  const catId = String(formData.get("cat_id"));
  const detail = `/app/colonies/${colonyId}/cats/${catId}`;
  function fail(message: string): never {
    redirect(`${detail}?error=${encodeURIComponent(message)}`);
  }

  const svc = createServiceClient();
  const { data, error } = await svc
    .from("cats")
    .update({ status: "active" })
    .eq("id", catId)
    .eq("organisation_id", org.organisation_id)
    .eq("status", UNCONFIRMED_STATUS)
    .is("deleted_at", null)
    .select("id");

  if (isFailedWrite({ error, rows: data })) {
    fail(
      writeErrorMessage(
        { error, rows: data },
        "This cat isn’t awaiting review anymore.",
      ),
    );
  }

  revalidatePath(`/app/colonies/${colonyId}`);
  revalidatePath(detail);
  redirect(`/app/colonies/${colonyId}?confirmed=cat`);
}

// ── rejectCat ────────────────────────────────────────────────────────────────
// Caretaker/Admin only. Soft-deletes a reported cat (sets deleted_at). The
// status-history trigger fires on status CHANGE, not on deleted_at, so a pure
// soft-delete is intentionally NOT status-history-audited (approved design).
// Same trust boundary + status guard + isFailedWrite as confirmCat.
export async function rejectCat(formData: FormData) {
  const org = await requireManagerOrg();
  const colonyId = String(formData.get("colony_id"));
  const catId = String(formData.get("cat_id"));
  const detail = `/app/colonies/${colonyId}/cats/${catId}`;
  function fail(message: string): never {
    redirect(`${detail}?error=${encodeURIComponent(message)}`);
  }

  const svc = createServiceClient();
  const { data, error } = await svc
    .from("cats")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", catId)
    .eq("organisation_id", org.organisation_id)
    .eq("status", UNCONFIRMED_STATUS)
    .is("deleted_at", null)
    .select("id");

  if (isFailedWrite({ error, rows: data })) {
    fail(
      writeErrorMessage(
        { error, rows: data },
        "This cat isn’t awaiting review anymore.",
      ),
    );
  }

  revalidatePath(`/app/colonies/${colonyId}`);
  redirect(`/app/colonies/${colonyId}?rejected=cat`);
}
