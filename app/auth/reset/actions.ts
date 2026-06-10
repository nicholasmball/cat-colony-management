"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { passwordError } from "@/lib/password";

// Step 2 of the forgot-password flow: set the new password. The recovery link
// has already passed through /auth/confirm, which verified the token and set the
// session — so the caller is authenticated here and we just updateUser({password}).
// A session-less arrival (expired/invalid link) is sent back to request a new one.
export async function setNewPassword(formData: FormData) {
  const t = await getTranslations("errors");
  const tAuth = await getTranslations("auth");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const validation = passwordError(password, confirm);
  if (validation) {
    redirect(`/auth/reset?error=${encodeURIComponent(t(validation))}`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // No session → the recovery link was invalid/expired. Send them to request
    // a fresh one rather than silently failing.
    redirect(
      `/forgot-password?error=${encodeURIComponent(tAuth("resetLinkInvalid"))}`,
    );
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect(`/auth/reset?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/app");
}
