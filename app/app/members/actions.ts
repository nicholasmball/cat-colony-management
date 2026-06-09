"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveOrg } from "@/lib/active-org";
import { isFailedWrite, writeErrorMessage } from "@/lib/mutation-result";
import { canChangeRole, type AppRole } from "@/lib/member-role";

const MEMBERS = "/app/members";

async function siteOrigin() {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
}

// Best-effort: auto-send the invite email via Supabase. If email isn't
// configured yet, this is a no-op for onboarding — the admin can still copy the
// invite link from the pending list. Returns false if the email couldn't be sent.
async function sendInviteEmail(email: string): Promise<boolean> {
  const svc = createServiceClient();
  const origin = await siteOrigin();
  const { error } = await svc.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/auth/confirm?next=/accept`,
  });
  // "already registered" etc. → fine, the copy-link path still works.
  return !error;
}

// Every action in here is admin-only. Verify the caller is an admin of the
// active org before doing anything (UI also hides these, but never trust that).
async function requireAdminOrg() {
  const org = await getActiveOrg();
  if (!org) redirect("/app");
  if (org.role !== "admin") redirect("/app");
  return org;
}

function err(message: string): never {
  redirect(`${MEMBERS}?error=${encodeURIComponent(message)}`);
}

export async function inviteVolunteer(formData: FormData) {
  const org = await requireAdminOrg();
  const t = await getTranslations("errors");
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const role = String(formData.get("role") ?? "");

  if (!email.includes("@") || email.length < 3) {
    err(t("validEmailRequired"));
  }
  if (role !== "caretaker" && role !== "feeder") {
    err(t("roleRequired"));
  }

  // Block inviting someone who's already an active member of this org.
  const svc = createServiceClient();
  const { data: list } = await svc.auth.admin.listUsers();
  const existing = list?.users.find((u) => u.email?.toLowerCase() === email);
  if (existing) {
    const { data: mem } = await svc
      .from("memberships")
      .select("id")
      .eq("user_id", existing.id)
      .eq("organisation_id", org.organisation_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (mem) err(t("alreadyMember"));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from("invitations").insert({
    organisation_id: org.organisation_id,
    email,
    role,
    invited_by: user?.id,
  });
  if (error) {
    err(error.code === "23505" ? t("pendingInviteExists") : error.message);
  }

  const sent = await sendInviteEmail(email);
  revalidatePath(MEMBERS);
  redirect(
    `${MEMBERS}?invited=${encodeURIComponent(email)}&sent=${sent ? 1 : 0}`,
  );
}

export async function resendInvite(formData: FormData) {
  await requireAdminOrg();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (email) await sendInviteEmail(email);
  revalidatePath(MEMBERS);
  redirect(`${MEMBERS}?invited=${encodeURIComponent(email)}&sent=1`);
}

export async function revokeInvite(formData: FormData) {
  await requireAdminOrg();
  const id = String(formData.get("invite_id") ?? "");
  const supabase = await createClient();
  await supabase.from("invitations").delete().eq("id", id);
  revalidatePath(MEMBERS);
  redirect(MEMBERS);
}

export async function deactivateMember(formData: FormData) {
  const org = await requireAdminOrg();
  const t = await getTranslations("errors");
  const userId = String(formData.get("user_id") ?? "");
  const svc = createServiceClient();

  // Never deactivate the last remaining admin.
  const { data: admins } = await svc
    .from("memberships")
    .select("user_id")
    .eq("organisation_id", org.organisation_id)
    .eq("role", "admin")
    .is("deleted_at", null);
  const targetIsAdmin = admins?.some((a) => a.user_id === userId);
  if (targetIsAdmin && (admins?.length ?? 0) <= 1) {
    err(t("cantDeactivateLastAdmin"));
  }

  // .select() + isFailedWrite turns a 0-row match (membership gone / already
  // changed) into a visible failure instead of a silent success — mirrors
  // deleteSchedule/updateSchedule/updateMemberRole.
  const { data, error } = await svc
    .from("memberships")
    .update({ deleted_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("organisation_id", org.organisation_id)
    .select("user_id");
  if (isFailedWrite({ error, rows: data })) {
    err(writeErrorMessage({ error, rows: data }, t("memberNoLongerExists")));
  }
  revalidatePath(MEMBERS);
  redirect(MEMBERS);
}

export async function reactivateMember(formData: FormData) {
  const org = await requireAdminOrg();
  const t = await getTranslations("errors");
  const userId = String(formData.get("user_id") ?? "");
  const svc = createServiceClient();
  // Same 0-row guard as deactivateMember: a reactivate hitting a non-existent
  // membership must surface, not look like success.
  const { data, error } = await svc
    .from("memberships")
    .update({ deleted_at: null })
    .eq("user_id", userId)
    .eq("organisation_id", org.organisation_id)
    .select("user_id");
  if (isFailedWrite({ error, rows: data })) {
    err(writeErrorMessage({ error, rows: data }, t("memberNoLongerExists")));
  }
  revalidatePath(MEMBERS);
  redirect(MEMBERS);
}

export async function updateMemberRole(formData: FormData) {
  const org = await requireAdminOrg();
  const t = await getTranslations("errors");
  const target = String(formData.get("user_id") ?? "");
  const newRole = String(formData.get("role") ?? "");

  // Who's acting — needed for the self-change guard. org id always comes from
  // the server-trusted active org, never from formData.
  const supabase = await createClient();
  const {
    data: { user: actor },
  } = await supabase.auth.getUser();
  if (!actor) redirect("/app");

  const svc = createServiceClient();

  // One bounded read for the target's current membership, one for the active
  // admins (reuses deactivateMember's count query). No per-row fan-out.
  const [{ data: targetRow }, { data: admins }] = await Promise.all([
    svc
      .from("memberships")
      .select("user_id, role, deleted_at")
      .eq("user_id", target)
      .eq("organisation_id", org.organisation_id)
      .maybeSingle(),
    svc
      .from("memberships")
      .select("user_id")
      .eq("organisation_id", org.organisation_id)
      .eq("role", "admin")
      .is("deleted_at", null),
  ]);

  if (!targetRow) err(t("memberNoLongerExists"));

  // Defer every guardrail to the pure, unit-tested decision function.
  const decision = canChangeRole({
    actorUserId: actor.id,
    target: {
      userId: targetRow.user_id,
      currentRole: targetRow.role as AppRole,
      isActive: targetRow.deleted_at === null,
    },
    newRole,
    activeAdminCount: admins?.length ?? 0,
  });

  if (!decision.ok) err(decision.reason);
  // No-op (role unchanged): skip the write, redirect back cleanly.
  if (decision.noop) redirect(MEMBERS);

  const { data, error } = await svc
    .from("memberships")
    .update({ role: newRole })
    .eq("user_id", target)
    .eq("organisation_id", org.organisation_id)
    .is("deleted_at", null)
    .select("user_id");
  if (isFailedWrite({ error, rows: data })) {
    err(writeErrorMessage({ error, rows: data }, t("memberNoLongerExists")));
  }

  revalidatePath(MEMBERS);
  redirect(`${MEMBERS}?updated=${encodeURIComponent(target)}&role=${newRole}`);
}
