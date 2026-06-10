"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

// Request a password-reset email. The email itself is sent by SUPABASE AUTH SMTP
// (custom SMTP configured at the deploy step — see docs/email-setup.md), NOT by
// the lib/email layer: reset/confirm mails are owned by Supabase Auth.
//
// Existence-safe: we ALWAYS redirect to the same "if that email exists…" success
// screen, regardless of whether the account exists or resetPasswordForEmail
// errored, so the form never leaks which addresses are registered.
export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  if (email.includes("@") && email.length >= 3) {
    const supabase = await createClient();
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
    // The recovery link lands on /auth/confirm (verifies the token + sets the
    // session) then forwards to /auth/reset where the user picks a new password.
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/confirm?next=/auth/reset`,
    });
  }

  redirect("/forgot-password?sent=1");
}
