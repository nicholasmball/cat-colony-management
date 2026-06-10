// The ONLY provider-specific file. Everything else in lib/email is provider-
// agnostic and talks to this through sendViaResend()'s signature, so swapping
// Resend for another provider later is a one-file change (plus the dep).
//
// The `resend` SDK is LAZY-imported inside the function: the default build runs
// with the email layer OFF (flag absent), and index.ts only ever reaches this
// adapter when armed — so the SDK is never loaded (and a missing/peer dep can
// never break) on the no-op path. SERVER-ONLY.

export type AdapterMessage = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type AdapterResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

export async function sendViaResend(
  message: AdapterMessage,
): Promise<AdapterResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY missing" };

  // Lazy import: only loaded on the armed send path.
  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);

  const { data, error } = await resend.emails.send({
    from: message.from,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data?.id };
}
