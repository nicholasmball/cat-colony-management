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
