"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { passwordError } from "@/lib/password";

// Set a password and join. Handles both arrival paths:
//  - via the invite EMAIL  → user is already signed in (no password yet)
//  - via the copied LINK   → not signed in; ?token identifies the invite
// In both cases we end with: password set, signed in, membership created.
export async function completeAccept(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const back = token ? `/accept?token=${encodeURIComponent(token)}` : "/accept";
  const t = await getTranslations("errors");

  const validation = passwordError(password, confirm);
  if (validation) {
    redirect(
      `${back}${token ? "&" : "?"}error=${encodeURIComponent(t(validation))}`,
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const svc = createServiceClient();

  // Resolve which invite we're redeeming + the email it's for.
  let inviteToken = token;
  let inviteEmail: string | null = null;
  if (user) {
    // Email path: find this account's pending invite.
    inviteEmail = user.email ?? null;
    const { data: inv } = await svc
      .from("invitations")
      .select("token, email")
      .ilike("email", inviteEmail ?? "")
      .is("accepted_at", null)
      .limit(1)
      .maybeSingle();
    if (inv) inviteToken = inv.token;
  } else {
    // Copy-link path: the token identifies the invite.
    const { data: inv } = await svc
      .from("invitations")
      .select("email, accepted_at")
      .eq("token", token)
      .maybeSingle();
    if (!inv || inv.accepted_at) {
      redirect(
        `${back}${token ? "&" : "?"}error=${encodeURIComponent(t("inviteInvalidOrUsed"))}`,
      );
    }
    inviteEmail = inv.email;
  }

  if (!inviteToken || !inviteEmail) {
    redirect(
      `${back}${token ? "&" : "?"}error=${encodeURIComponent(t("noPendingInvite"))}`,
    );
  }

  if (user) {
    // Already authenticated (email path): just set the password.
    const { error: pwErr } = await supabase.auth.updateUser({ password });
    if (pwErr)
      redirect(
        `${back}${token ? "&" : "?"}error=${encodeURIComponent(pwErr.message)}`,
      );
  } else {
    // Copy-link path: ensure an account exists with this password, then sign in.
    const { data: list } = await svc.auth.admin.listUsers();
    const existing = list?.users.find(
      (u) => u.email?.toLowerCase() === inviteEmail!.toLowerCase(),
    );
    if (existing) {
      await svc.auth.admin.updateUserById(existing.id, { password });
    } else {
      await svc.auth.admin.createUser({
        email: inviteEmail,
        password,
        email_confirm: true,
      });
    }
    const { error: signErr } = await supabase.auth.signInWithPassword({
      email: inviteEmail,
      password,
    });
    if (signErr)
      redirect(
        `${back}${token ? "&" : "?"}error=${encodeURIComponent(signErr.message)}`,
      );
  }

  const { error: rpcErr } = await supabase.rpc("accept_invitation", {
    p_token: inviteToken,
  });
  if (rpcErr) {
    redirect(
      `${back}${token ? "&" : "?"}error=${encodeURIComponent(rpcErr.message)}`,
    );
  }
  redirect("/app");
}
