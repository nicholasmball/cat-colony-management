"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveOrg } from "@/lib/active-org";
import { isFailedWrite, writeErrorMessage } from "@/lib/mutation-result";
import { canChangeRole, type AppRole } from "@/lib/member-role";
import { canEraseMember } from "@/lib/member-admin";
import { emailModeFromEnv } from "@/lib/email/flags";
import { inviteEmailPath } from "@/lib/email/invite-plan";
import { send } from "@/lib/email";
import { isLocale, type Locale } from "@/i18n/locale";

const MEMBERS = "/app/members";

async function siteOrigin() {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
}

// The inviting admin's current locale (the invitee has no account yet, so we
// brand the email in the admin's language; fallback PT — SCoT's primary
// audience). Read from the same locale cookie the app's i18n pipeline uses.
async function adminLocale(): Promise<Locale> {
  const value = (await cookies()).get("locale")?.value;
  return isLocale(value) ? value : "pt";
}

// Auto-send the invite. Two paths, chosen by whether the email layer is ARMED:
//   * armed (EMAIL_ENABLED + RESEND_API_KEY) → send the BRANDED invite via
//     lib/email, linking the copy-link accept URL. Returns true on a real send.
//   * off (default) → TODAY'S behaviour exactly: best-effort Supabase
//     inviteUserByEmail; the admin can always copy the invite link regardless.
// This flow must NEVER break or depend on Resend — a failure just means the
// admin uses the copy-link path (sent=0).
async function sendInviteEmail(
  email: string,
  opts: { acceptUrl?: string; orgName?: string; role?: string } = {},
): Promise<boolean> {
  if (inviteEmailPath(emailModeFromEnv(), opts.acceptUrl) === "branded") {
    const result = await send({
      to: email,
      locale: await adminLocale(),
      template: "invite",
      params: {
        acceptUrl: opts.acceptUrl!,
        orgName: opts.orgName ?? "",
        role: opts.role ?? "",
      },
    });
    return result.skipped === false && result.ok === true;
  }

  // Off path — unchanged: Supabase best-effort, copy-link fallback always works.
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

  // Re-issue, don't fail: a prior invitation row for (org, lower(email)) —
  // whether ACCEPTED (the person has since been removed/erased) or a stale
  // pending one — would otherwise 23505 against invitations_org_email_key and
  // silently block the re-invite. Delete any existing row for this org+email
  // (case-insensitive; the stored email may be mixed-case while `email` here is
  // lowercased), then insert a fresh row with a new default token. The RLS
  // admin INSERT + DELETE policies cover both halves (there is no UPDATE policy,
  // so delete-then-insert is the RLS-safe way to re-issue). The 23505 branch
  // below now only guards a genuine concurrent-insert race.
  await supabase
    .from("invitations")
    .delete()
    .eq("organisation_id", org.organisation_id)
    .ilike("email", email);

  const { data: inserted, error } = await supabase
    .from("invitations")
    .insert({
      organisation_id: org.organisation_id,
      email,
      role,
      invited_by: user?.id,
    })
    .select("token")
    .maybeSingle();
  if (error) {
    err(error.code === "23505" ? t("pendingInviteExists") : error.message);
  }

  const origin = await siteOrigin();
  const sent = await sendInviteEmail(email, {
    acceptUrl: inserted?.token
      ? `${origin}/accept?token=${inserted.token}`
      : undefined,
    orgName: org.name,
    role,
  });
  revalidatePath(MEMBERS);
  redirect(
    `${MEMBERS}?invited=${encodeURIComponent(email)}&sent=${sent ? 1 : 0}`,
  );
}

export async function resendInvite(formData: FormData) {
  const org = await requireAdminOrg();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (email) {
    // For the branded (armed) path, look up this org's pending invite so we can
    // rebuild the copy-link accept URL + role. The off path ignores these.
    const svc = createServiceClient();
    const { data: inv } = await svc
      .from("invitations")
      .select("token, role")
      .eq("organisation_id", org.organisation_id)
      .ilike("email", email)
      .is("accepted_at", null)
      .maybeSingle();
    const origin = await siteOrigin();
    await sendInviteEmail(email, {
      acceptUrl: inv?.token ? `${origin}/accept?token=${inv.token}` : undefined,
      orgName: org.name,
      role: inv?.role,
    });
  }
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

// Permanently ERASE a member's account — the GDPR right-to-be-forgotten action.
// This is DESTRUCTIVE and IRREVERSIBLE, and deliberately separate from the
// reversible deactivateMember/reactivateMember (which only soft-delete the
// membership). We delete the auth.users record itself, which:
//   • CASCADES their membership rows + notifications away, and
//   • NULLs every attribution FK (cats.reported_by/confirmed_by,
//     cat_status_history.changed_by, feeding_events/cat_sightings.feeder_id,
//     incidents.reported_by/assigned_to, incident_comments.author_id,
//     cat_concern_reviews.reviewed_by, attachments.uploaded_by,
//     invitations.invited_by, audit_log.actor_id — all ON DELETE SET NULL),
// so their past activity is anonymised rather than deleted (history stays
// intact, attribution lines degrade to no-name via attributionEmail).
//
// NOTE: deleting the auth user is GLOBAL — it removes them from ALL orgs and
// cascades everywhere. That is correct for GDPR erasure. The org-membership
// check below is the AUTHORISATION gate: an admin may only initiate erasure for
// someone who is currently a member of THIS org.
export async function eraseMember(formData: FormData) {
  const org = await requireAdminOrg();
  const t = await getTranslations("errors");
  const targetUserId = String(formData.get("user_id") ?? "");

  // Who's acting — needed for the never-erase-self guard. The org id always
  // comes from the server-trusted active org, never from formData.
  const supabase = await createClient();
  const {
    data: { user: actor },
  } = await supabase.auth.getUser();
  if (!actor) redirect("/app");

  const svc = createServiceClient();

  // One bounded read for the target's membership in THIS org, one for the
  // org's active admins (reuses deactivateMember's count query). No fan-out.
  const [{ data: targetRow }, { data: admins }] = await Promise.all([
    // Target read is deleted_at-AGNOSTIC: a DEACTIVATED member (deleted_at set)
    // is still erasable, so we must find them. We select deleted_at to tell the
    // decision function whether the target is active (drives the last-admin rail).
    svc
      .from("memberships")
      .select("user_id, role, deleted_at")
      .eq("user_id", targetUserId)
      .eq("organisation_id", org.organisation_id)
      .maybeSingle(),
    // Admin-count read STAYS active-only: the last-admin rail counts ACTIVE admins.
    svc
      .from("memberships")
      .select("user_id")
      .eq("organisation_id", org.organisation_id)
      .eq("role", "admin")
      .is("deleted_at", null),
  ]);

  // Defer every rail to the pure, unit-tested decision function. The reason it
  // returns is an i18n key in the `errors` namespace.
  const decision = canEraseMember({
    actingUserId: actor.id,
    targetUserId,
    targetRole: (targetRow?.role ?? "feeder") as AppRole,
    adminCount: admins?.length ?? 0,
    targetInOrg: !!targetRow,
    targetActive: !!targetRow && targetRow.deleted_at === null,
  });
  if (!decision.ok) err(t(decision.reason));

  // GDPR: an invitation row stores the invitee's email — personal data. Erasing
  // the person must also clear their invitation(s) in THIS org (scoped to the
  // acting admin's org, never cross-org), which both removes the lingering email
  // and unblocks any future re-invite of that address. Best-effort: we look up
  // the email off the auth user (the membership row doesn't carry it) and delete
  // the matching invitation rows BEFORE the destructive auth delete, while the
  // user still exists. A failure here must NOT abort the erase — log and proceed.
  const { data: targetUser } = await svc.auth.admin.getUserById(targetUserId);
  const targetEmail = targetUser.user?.email;
  if (targetEmail) {
    const { error: inviteCleanupError } = await svc
      .from("invitations")
      .delete()
      .eq("organisation_id", org.organisation_id)
      .ilike("email", targetEmail);
    if (inviteCleanupError) {
      console.error(
        "eraseMember: invitation cleanup failed (continuing erase)",
        inviteCleanupError,
      );
    }
  }

  // The destructive call. Check the returned error — on failure, surface it as
  // a visible error (NEVER redirect with a success flag on a failed delete).
  const { error } = await svc.auth.admin.deleteUser(targetUserId);
  if (error) {
    err(writeErrorMessage({ error, rows: [{}] }, t("memberNoLongerExists")));
  }

  revalidatePath(MEMBERS);
  redirect(`${MEMBERS}?ok=erased`);
}
