"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getActiveOrg } from "@/lib/active-org";

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
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const role = String(formData.get("role") ?? "");

  if (!email.includes("@") || email.length < 3) {
    err("Enter a valid email address.");
  }
  if (role !== "caretaker" && role !== "feeder") {
    err("Choose a role.");
  }

  // Block inviting someone who's already an active member of this org.
  const svc = createServiceClient();
  const { data: list } = await svc.auth.admin.listUsers();
  const existing = list?.users.find(
    (u) => u.email?.toLowerCase() === email,
  );
  if (existing) {
    const { data: mem } = await svc
      .from("memberships")
      .select("id")
      .eq("user_id", existing.id)
      .eq("organisation_id", org.organisation_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (mem) err("That person is already a member.");
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
    err(
      error.code === "23505"
        ? "That email already has a pending invite."
        : error.message,
    );
  }

  const sent = await sendInviteEmail(email);
  revalidatePath(MEMBERS);
  redirect(`${MEMBERS}?invited=${encodeURIComponent(email)}&sent=${sent ? 1 : 0}`);
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
    err("You can’t deactivate the last admin.");
  }

  await svc
    .from("memberships")
    .update({ deleted_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("organisation_id", org.organisation_id);
  revalidatePath(MEMBERS);
  redirect(MEMBERS);
}

export async function reactivateMember(formData: FormData) {
  const org = await requireAdminOrg();
  const userId = String(formData.get("user_id") ?? "");
  const svc = createServiceClient();
  await svc
    .from("memberships")
    .update({ deleted_at: null })
    .eq("user_id", userId)
    .eq("organisation_id", org.organisation_id);
  revalidatePath(MEMBERS);
  redirect(MEMBERS);
}
